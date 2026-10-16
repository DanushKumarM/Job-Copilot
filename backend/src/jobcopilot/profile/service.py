"""Profile and evidence: facts are proposed, verified by the user, and superseded rather than edited."""

import re
import uuid
from collections.abc import Iterable
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from jobcopilot.audit import service as audit
from jobcopilot.db import utcnow
from jobcopilot.enums import Actor, FactKind, FactStatus
from jobcopilot.errors import DomainError, NotFound
from jobcopilot.generation.validator import FactView
from jobcopilot.profile.models import AnswerBankEntry, ProfileFact, SourceDocument, User
from jobcopilot.text import display_term, find_numbers, find_terms, sha256_text

ANSWER_STALE_AFTER = timedelta(days=90)

# Answer-bank keys for contact details. The PDF header and the extension's form filling read these.
CONTACT_FIELDS = {
    "full_name": "Full name",
    "email": "Email",
    "phone": "Phone",
    "location": "Current location",
    "linkedin": "LinkedIn URL",
    "github": "GitHub URL",
    "website": "Website or portfolio URL",
}


def get_or_create_user(session: Session, email: str) -> User:
    normalized = email.strip().lower()
    session.execute(insert(User).values(id=uuid.uuid4(), email=normalized, preferences={}).on_conflict_do_nothing())
    return session.scalars(select(User).where(User.email == normalized)).one()


def get_fact(session: Session, user_id: uuid.UUID, fact_id: uuid.UUID) -> ProfileFact:
    fact = session.get(ProfileFact, fact_id)
    if fact is None or fact.user_id != user_id:
        raise NotFound(f"fact {fact_id}")
    return fact


def list_facts(session: Session, user_id: uuid.UUID, statuses: Iterable[FactStatus] | None = None) -> list[ProfileFact]:
    query = select(ProfileFact).where(ProfileFact.user_id == user_id).order_by(ProfileFact.created_at)
    if statuses:
        query = query.where(ProfileFact.status.in_([str(s) for s in statuses]))
    return list(session.scalars(query))


def fact_views(facts: Iterable[ProfileFact]) -> dict[uuid.UUID, FactView]:
    return {f.id: FactView(f.id, f.user_id, f.status, f.statement, f.details or {}) for f in facts}


def load_fact_views(session: Session, user_id: uuid.UUID, fact_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, FactView]:
    ids = set(fact_ids)
    if not ids:
        return {}
    rows = session.scalars(select(ProfileFact).where(ProfileFact.id.in_(ids), ProfileFact.user_id == user_id))
    return fact_views(rows)


def propose_fact(
    session: Session,
    user_id: uuid.UUID,
    kind: FactKind,
    statement: str,
    details: dict | None = None,
    source_document_id: uuid.UUID | None = None,
) -> ProfileFact:
    fact = ProfileFact(
        user_id=user_id,
        kind=kind,
        statement=statement.strip(),
        details=details or {},
        status=FactStatus.PROPOSED,
        source_document_id=source_document_id,
    )
    session.add(fact)
    session.flush()
    return fact


def _set_status(session: Session, user_id: uuid.UUID, fact_id: uuid.UUID, status: FactStatus) -> ProfileFact:
    fact = get_fact(session, user_id, fact_id)
    if fact.status != FactStatus.PROPOSED:
        raise DomainError(f"only proposed facts can be {status}; this one is {fact.status}")
    fact.status = status
    if status == FactStatus.VERIFIED:
        fact.verified_at = utcnow()
    audit.record(
        session,
        user_id=user_id,
        actor=Actor.USER,
        action=f"fact.{status}",
        entity_type="profile_fact",
        entity_id=fact.id,
    )
    session.flush()
    return fact


def verify_fact(session: Session, user_id: uuid.UUID, fact_id: uuid.UUID) -> ProfileFact:
    return _set_status(session, user_id, fact_id, FactStatus.VERIFIED)


def reject_fact(session: Session, user_id: uuid.UUID, fact_id: uuid.UUID) -> ProfileFact:
    return _set_status(session, user_id, fact_id, FactStatus.REJECTED)


def revise_fact(
    session: Session, user_id: uuid.UUID, fact_id: uuid.UUID, statement: str, details: dict | None = None
) -> ProfileFact:
    """Replace a fact with a corrected one written by the user (so already verified).

    The old row stays, marked superseded, so documents that cited it remain explainable (design 12.2).
    """
    old = get_fact(session, user_id, fact_id)
    if old.status in {FactStatus.SUPERSEDED, FactStatus.REJECTED}:
        raise DomainError(f"cannot revise a {old.status} fact")
    new = ProfileFact(
        user_id=user_id,
        kind=old.kind,
        statement=statement.strip(),
        details=old.details if details is None else details,
        status=FactStatus.VERIFIED,
        verified_at=utcnow(),
        source_document_id=old.source_document_id,
    )
    session.add(new)
    session.flush()
    old.status = FactStatus.SUPERSEDED
    old.superseded_by = new.id
    audit.record(
        session,
        user_id=user_id,
        actor=Actor.USER,
        action="fact.revised",
        entity_type="profile_fact",
        entity_id=old.id,
        details={"superseded_by": str(new.id)},
    )
    session.flush()
    return new


# --- resume import --------------------------------------------------------------------------------

_BULLET = re.compile(r"^\s*(?:[-*•·▪◦]|\d+[.)])\s+")
_SKILLS_LINE = re.compile(r"^\s*(?:technical\s+)?skills?\s*[:\-]\s*(.+)$", re.IGNORECASE)
_TOTAL_YEARS = re.compile(
    r"(\d+(?:\.\d+)?)\+?\s*years?\s+(?:of\s+)?(?:professional\s+|industry\s+|work\s+)?experience", re.IGNORECASE
)


def import_resume_text(session: Session, user_id: uuid.UUID, text: str, file_path: str) -> list[ProfileFact]:
    """Split resume text into proposed facts: one per bullet, one per listed skill, total experience.

    Deliberately conservative. Nothing here is usable until the user verifies it (FR2).
    """
    doc = SourceDocument(user_id=user_id, file_path=file_path, sha256=sha256_text(text))
    session.add(doc)
    session.flush()

    proposed: list[ProfileFact] = []
    seen_skills: set[str] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if match := _SKILLS_LINE.match(line):
            for skill in sorted(find_terms(match.group(1)) - seen_skills):
                seen_skills.add(skill)
                statement = f"Skilled in {display_term(skill)}"
                proposed.append(propose_fact(session, user_id, FactKind.SKILL, statement, {"skills": [skill]}, doc.id))
            continue
        if match := _TOTAL_YEARS.search(line):
            proposed.append(
                propose_fact(
                    session, user_id, FactKind.EXPERIENCE, line, {"total_years": float(match.group(1))}, doc.id
                )
            )
            continue
        if _BULLET.match(line):
            body = _BULLET.sub("", line)
            kind = FactKind.ACHIEVEMENT if find_numbers(body) else FactKind.PROJECT
            proposed.append(propose_fact(session, user_id, kind, body, {"skills": sorted(find_terms(body))}, doc.id))
    audit.record(
        session,
        user_id=user_id,
        actor=Actor.SYSTEM,
        action="resume.imported",
        entity_type="source_document",
        entity_id=doc.id,
        details={"proposed": len(proposed)},
    )
    return proposed


# --- answer bank ----------------------------------------------------------------------------------


def upsert_answer(
    session: Session, user_id: uuid.UUID, question_key: str, question: str, answer: str
) -> AnswerBankEntry:
    entry = session.scalars(
        select(AnswerBankEntry).where(AnswerBankEntry.user_id == user_id, AnswerBankEntry.question_key == question_key)
    ).one_or_none()
    if entry is None:
        entry = AnswerBankEntry(
            user_id=user_id, question_key=question_key, question=question, answer=answer, last_confirmed_at=utcnow()
        )
        session.add(entry)
    else:
        entry.question, entry.answer, entry.last_confirmed_at = question, answer, utcnow()
    session.flush()
    return entry


def is_stale(entry: AnswerBankEntry) -> bool:
    return utcnow() - entry.last_confirmed_at > ANSWER_STALE_AFTER
