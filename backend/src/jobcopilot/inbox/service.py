"""Inbox sync: read new mail, classify, match to an application, and apply it as evidence.

Each message is recorded once in inbound_messages (by Gmail ID) with its subject, sender and outcome,
never its body. Messages that cannot be placed confidently wait in the inbox queue for the user.
Job-alert emails become jobs; a confirmation for an application made outside job-copilot creates
that application, so it is tracked like the rest.
"""

import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from jobcopilot.audit import service as audit
from jobcopilot.config import get_settings
from jobcopilot.db import utcnow
from jobcopilot.enums import Actor, AppStatus, EvidenceKind, MessageClass
from jobcopilot.errors import DomainError, NotFound
from jobcopilot.inbox import alerts, external
from jobcopilot.inbox.classifier import classify
from jobcopilot.inbox.gmail import MailSource
from jobcopilot.inbox.matcher import Candidate, match
from jobcopilot.ingestion import service as ingestion
from jobcopilot.ingestion.adapters.base import NormalizedPosting, guess_work_mode
from jobcopilot.ingestion.models import Company, Job, Source
from jobcopilot.lifecycle import service as lifecycle
from jobcopilot.lifecycle.models import Application, ApplicationEvent, Evidence, InboundMessage
from jobcopilot.matching import service as matching
from jobcopilot.profile.models import User

GMAIL_SOURCE_KIND = "gmail"
EMAIL_IMPORT_KIND = "email_import"
# Re-read this much before the last seen message: Gmail's `after:` is coarse, duplicates are skipped by ID.
OVERLAP = timedelta(hours=1)

EVIDENCE_FOR = {
    MessageClass.CONFIRMATION: EvidenceKind.CONFIRMATION_EMAIL,
    MessageClass.REJECTION: EvidenceKind.REJECTION_EMAIL,
    MessageClass.ASSESSMENT: EvidenceKind.ASSESSMENT_EMAIL,
    MessageClass.INTERVIEW: EvidenceKind.INTERVIEW_EMAIL,
    MessageClass.OFFER: EvidenceKind.OFFER_EMAIL,
}

# Applications an email could plausibly be about: anything the user may have sent.
_OPEN_FOR_EMAIL = [
    AppStatus.APPROVED,
    AppStatus.SUBMISSION_IN_PROGRESS,
    AppStatus.SUBMITTED_UNCONFIRMED,
    AppStatus.SUBMISSION_CONFIRMED,
    AppStatus.ASSESSMENT,
    AppStatus.INTERVIEW,
    AppStatus.NEEDS_MANUAL_INTERVENTION,
]


@dataclass
class SyncReport:
    fetched: int = 0
    skipped_known: int = 0
    actions: Counter = field(default_factory=Counter)


def gmail_source(session: Session, user_id: uuid.UUID) -> Source:
    source = session.scalars(select(Source).where(Source.user_id == user_id, Source.kind == GMAIL_SOURCE_KIND)).first()
    if source is None:
        source = Source(
            user_id=user_id,
            kind=GMAIL_SOURCE_KIND,
            config={},
            access_basis="user's own inbox, Gmail API read-only scope",
        )
        session.add(source)
        session.flush()
    return source


def candidates(session: Session, user_id: uuid.UUID) -> list[Candidate]:
    rows = session.execute(
        select(Application.id, Company.name, Job.title)
        .join(Job, Job.id == Application.job_id)
        .join(Company, Company.id == Job.company_id)
        .where(Application.user_id == user_id, Application.status.in_([str(s) for s in _OPEN_FOR_EMAIL]))
    ).all()
    return [Candidate(app_id, company, title) for app_id, company, title in rows]


def sync(session: Session, user_id: uuid.UUID, mail: MailSource) -> SyncReport:
    """Process new mail since the last sync. Safe to run repeatedly or concurrently with itself."""
    source = gmail_source(session, user_id)
    cursor_ms = source.config.get("last_internal_ms")
    if cursor_ms is None:
        after = utcnow() - timedelta(days=get_settings().gmail_initial_lookback_days)
    else:
        after = datetime.fromtimestamp(cursor_ms / 1000, UTC) - OVERLAP
    report = SyncReport()
    open_apps = candidates(session, user_id)
    newest_ms = cursor_ms or 0

    messages = []
    for message_id in mail.message_ids(int(after.timestamp())):
        if session.scalar(select(InboundMessage.id).where(InboundMessage.gmail_message_id == message_id)):
            report.skipped_known += 1
            continue
        messages.append(mail.get(message_id))
    # Oldest first, so a confirmation creates its application before a later reply about it arrives.
    for message in sorted(messages, key=lambda m: m.received_at):
        report.fetched += 1
        newest_ms = max(newest_ms, int(message.received_at.timestamp() * 1000))
        action = process(session, user_id, message, open_apps)
        report.actions[action] += 1

    source.config = {**source.config, "last_internal_ms": newest_ms}
    source.last_polled_at = utcnow()
    source.health = "ok"
    audit.record(
        session,
        user_id=user_id,
        actor=Actor.SYSTEM,
        action="inbox.synced",
        entity_type="source",
        entity_id=source.id,
        details={"fetched": report.fetched, **report.actions},
    )
    session.flush()
    return report


def process(session: Session, user_id: uuid.UUID, message, open_apps: list[Candidate]) -> str:
    """Classify and place one message. Returns what happened, for the sync report."""
    result = classify(message)
    extracted = {
        "subject": message.subject[:300],
        "from": f"{message.from_name} <{message.from_address}>"[:300],
        "received_at": message.received_at.isoformat(),
        "signals": list(result.signals)[:10],
    }
    record = InboundMessage(
        user_id=user_id,
        gmail_message_id=message.id,
        classification=result.label,
        confidence=result.confidence,
        extracted=extracted,
    )
    session.add(record)

    kind = EVIDENCE_FOR.get(result.label)
    if kind is None:
        parsed = alerts.parse(message)
        if parsed is not None and (parsed.postings or result.label == MessageClass.JOB_ALERT):
            return _process_alert(session, user_id, record, parsed)
        # Unrelated mail: recorded so it is not fetched again, nothing else.
        record.resolved_at = utcnow()
        extracted["action"] = "ignored"
        session.flush()
        return f"ignored_{result.label}"

    found = match(message, open_apps)
    extracted["match_reason"] = found.reason
    if found.application_id is None:
        elsewhere = external.extract(message) if kind == EvidenceKind.CONFIRMATION_EMAIL else None
        if elsewhere is not None and result.confidence >= lifecycle.AUTO_APPLY_CONFIDENCE:
            return _process_external(session, user_id, record, message.id, elsewhere, result.confidence, open_apps)
        extracted["action"] = "unmatched"
        session.flush()
        return "unmatched"

    record.application_id = found.application_id
    app = session.get(Application, found.application_id)
    outcome = lifecycle.apply_evidence(
        session,
        app,
        kind,
        f"gmail:{message.id}",
        Actor.EMAIL,
        {"subject": extracted["subject"], "match_reason": found.reason},
        confidence=round(result.confidence * found.confidence, 3),
    )
    extracted["action"] = outcome.action
    if outcome.action != "needs_review":
        record.resolved_at = utcnow()
    session.flush()
    return outcome.action


def _process_alert(session: Session, user_id: uuid.UUID, record: InboundMessage, parsed: alerts.AlertResult) -> str:
    user = session.get(User, user_id)
    source = ingestion.ensure_source(
        session, user_id, f"{parsed.platform}_alert", {}, "job-alert emails in the user's own inbox"
    )
    new_jobs = 0
    for posting in parsed.postings:
        result = ingestion.ingest(session, source, posting)
        if result.new_job:
            new_jobs += 1
            matching.evaluate(session, user, result.job)
    source.last_polled_at = utcnow()
    # A known alert sender whose cards could not be read stays visible, so the parser can be fixed.
    action = "alert_parsed" if parsed.postings else "alert_unparsed"
    record.classification = MessageClass.JOB_ALERT
    record.resolved_at = utcnow()
    record.extracted = {
        **record.extracted,
        "action": action,
        "platform": parsed.platform,
        "jobs": len(parsed.postings),
        "new_jobs": new_jobs,
    }
    session.flush()
    return action


def _job_for(
    session: Session, user_id: uuid.UUID, gmail_message_id: str, elsewhere: external.ExternalApplication
) -> ingestion.IngestResult:
    """The job an off-system application was for: an existing one if dedupe finds it, else a new one."""
    source = ingestion.ensure_source(
        session, user_id, EMAIL_IMPORT_KIND, {}, "application emails in the user's own inbox"
    )
    posting = NormalizedPosting(
        external_id=f"email:{gmail_message_id}",
        company=elsewhere.company,
        title=elsewhere.title,
        description="",
        location=elsewhere.location,
        work_mode=guess_work_mode(elsewhere.location),
        raw={"email": gmail_message_id, "platform": elsewhere.platform},
    )
    return ingestion.ingest(session, source, posting)


def _process_external(
    session: Session,
    user_id: uuid.UUID,
    record: InboundMessage,
    gmail_message_id: str,
    elsewhere: external.ExternalApplication,
    confidence: float,
    open_apps: list[Candidate],
) -> str:
    """A confident confirmation of an application the system did not know about: start tracking it."""
    found = _job_for(session, user_id, gmail_message_id, elsewhere)
    app, _ = lifecycle.get_or_create_application(session, user_id, found.job.id)
    outcome = lifecycle.apply_evidence(
        session,
        app,
        EvidenceKind.CONFIRMATION_EMAIL,
        f"gmail:{gmail_message_id}",
        Actor.EMAIL,
        {"subject": record.extracted["subject"], "applied_via": elsewhere.platform},
        confidence=confidence,
    )
    if found.new_job:
        matching.evaluate(session, session.get(User, user_id), found.job)  # records a score; no status change
    action = f"imported:{outcome.action}"
    record.application_id = app.id
    record.extracted = {**record.extracted, "action": action, "applied_via": elsewhere.platform}
    if outcome.action != "needs_review":
        record.resolved_at = utcnow()
    if app.status in _OPEN_FOR_EMAIL:
        # Later mail in this same sync (a rejection, an interview invite) can now find it.
        company = session.get(Company, found.job.company_id)
        open_apps.append(Candidate(app.id, company.name, found.job.title))
    session.flush()
    return "imported"


def import_message(
    session: Session,
    user_id: uuid.UUID,
    message_id: uuid.UUID,
    company: str,
    title: str,
    location: str | None = None,
    label: MessageClass | None = None,
) -> Application:
    """The user says an email is about an application made outside job-copilot, and for which role."""
    record = _get(session, user_id, message_id)
    domain = record.extracted.get("from", "").rpartition("@")[2].rstrip(">").lower()
    platform = external.PLATFORM_BY_DOMAIN.get(domain, "email")
    elsewhere = external.ExternalApplication(platform, company.strip(), title.strip(), location)
    if label is None and MessageClass(record.classification) not in EVIDENCE_FOR:
        label = MessageClass.CONFIRMATION
    found = _job_for(session, user_id, record.gmail_message_id, elsewhere)
    app, _ = lifecycle.get_or_create_application(session, user_id, found.job.id)
    assign(session, user_id, message_id, app.id, label)
    if found.new_job:
        matching.evaluate(session, session.get(User, user_id), found.job)
    session.flush()
    return app


def unresolved(session: Session, user_id: uuid.UUID) -> list[InboundMessage]:
    return list(
        session.scalars(
            select(InboundMessage)
            .where(InboundMessage.user_id == user_id, InboundMessage.resolved_at.is_(None))
            .order_by(InboundMessage.processed_at.desc())
        )
    )


def _get(session: Session, user_id: uuid.UUID, message_id: uuid.UUID) -> InboundMessage:
    record = session.get(InboundMessage, message_id)
    if record is None or record.user_id != user_id:
        raise NotFound(f"inbound message {message_id}")
    return record


def assign(
    session: Session,
    user_id: uuid.UUID,
    message_id: uuid.UUID,
    application_id: uuid.UUID,
    label: MessageClass | None = None,
) -> Application:
    """The user says which application a message belongs to (and optionally corrects its class)."""
    record = _get(session, user_id, message_id)
    label = label or MessageClass(record.classification)
    kind = EVIDENCE_FOR.get(label)
    if kind is None:
        raise DomainError(f"a {label} message is not evidence for an application")
    app = lifecycle.get_application(session, user_id, application_id)
    ref = f"gmail:{record.gmail_message_id}"

    moved = False
    existing = session.scalars(select(Evidence).where(Evidence.external_ref == ref)).one_or_none()
    if existing is not None and existing.application_id != app.id:
        # The matcher guessed a different application. Release it, then move the evidence over.
        _release(session, existing, "email reassigned to another application by the user")
        existing.application_id = app.id
        session.flush()
        moved = True

    evidence, created = lifecycle.record_evidence(
        session, app, kind, ref, {"subject": record.extracted.get("subject")}, confidence=1.0
    )
    if created or moved or lifecycle.parked_by(session, app) == evidence.id:
        evidence.kind, evidence.confidence = kind, 1.0
        evidence.extracted = {**evidence.extracted, "assigned_by": "user"}
        action = lifecycle.act_on_evidence(session, app, evidence, Actor.USER).action
    else:
        action = "duplicate"
    record.application_id = app.id
    record.classification = label
    record.resolved_at = utcnow()
    record.extracted = {**record.extracted, "action": f"assigned:{action}"}
    session.flush()
    return app


def dismiss(session: Session, user_id: uuid.UUID, message_id: uuid.UUID) -> InboundMessage:
    """Not about any application. Releases an application the message had parked for review."""
    record = _get(session, user_id, message_id)
    evidence = session.scalars(
        select(Evidence).where(Evidence.external_ref == f"gmail:{record.gmail_message_id}")
    ).one_or_none()
    if evidence is not None:
        _release(session, evidence, "email dismissed by the user")
        evidence.extracted = {**evidence.extracted, "dismissed_by_user": True}
    record.resolved_at = utcnow()
    record.extracted = {**record.extracted, "action": "dismissed"}
    session.flush()
    return record


def _release(session: Session, evidence: Evidence, note: str) -> None:
    """Return the application this evidence parked to where it was. Refuses to undo real moves."""
    app = session.get(Application, evidence.application_id)
    if lifecycle.parked_by(session, app) == evidence.id:
        lifecycle.release_from_manual(session, app, Actor.USER, note)
    elif session.scalar(
        select(ApplicationEvent.id).where(
            ApplicationEvent.evidence_id == evidence.id, ApplicationEvent.from_status != ApplicationEvent.to_status
        )
    ):
        raise DomainError(
            f"this email already moved application {app.id} to {app.status}; correct that application first"
        )
