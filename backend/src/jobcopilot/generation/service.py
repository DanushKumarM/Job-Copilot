"""Generation and approval: content is stored as cited claims, and only validated content is stored."""

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from jobcopilot.enums import Actor, AppStatus, Coverage, DocumentKind, DocumentState, FactStatus
from jobcopilot.errors import DomainError, ValidationFailed
from jobcopilot.generation import prompts
from jobcopilot.generation.models import Claim, ClaimEvidence, GeneratedDocument
from jobcopilot.generation.validator import ClaimDraft, DocumentDraft, ScreeningDraft, validate_claims
from jobcopilot.ingestion.models import Company, Job
from jobcopilot.lifecycle import service as lifecycle
from jobcopilot.lifecycle.models import Application
from jobcopilot.llm.base import LLMProvider, call_structured
from jobcopilot.matching.models import RequirementMatch
from jobcopilot.matching.service import latest_evaluation, requirement_views
from jobcopilot.profile.models import AnswerBankEntry, ProfileFact
from jobcopilot.profile.service import is_stale, list_facts, load_fact_views

MAX_GENERATION_ATTEMPTS = 3

# Saving new content moves the application to review from any of these.
_TO_REVIEW_FROM = {AppStatus.SHORTLISTED, AppStatus.PREPARED, AppStatus.APPROVED}


def _job_terms(session: Session, job_id: uuid.UUID) -> frozenset[str]:
    return frozenset(t for r in requirement_views(session, job_id) for t in r.terms)


def latest_documents(session: Session, application_id: uuid.UUID) -> dict[str, GeneratedDocument]:
    newest = (
        select(GeneratedDocument.kind, func.max(GeneratedDocument.doc_version).label("v"))
        .where(GeneratedDocument.application_id == application_id)
        .group_by(GeneratedDocument.kind)
        .subquery()
    )
    docs = session.scalars(
        select(GeneratedDocument)
        .join(newest, (GeneratedDocument.kind == newest.c.kind) & (GeneratedDocument.doc_version == newest.c.v))
        .where(GeneratedDocument.application_id == application_id)
        .options(selectinload(GeneratedDocument.claims).selectinload(Claim.evidence))
    )
    return {d.kind: d for d in docs}


def save_version(
    session: Session,
    app: Application,
    kind: DocumentKind,
    draft: DocumentDraft,
    actor: Actor,
    *,
    prompt_version: str | None = None,
    model: str | None = None,
) -> GeneratedDocument:
    """Validate and store a new document version. Invalid content is never stored (raises)."""
    facts = load_fact_views(session, app.user_id, (f for c in draft.claims for f in c.fact_ids))
    report = validate_claims(draft.claims, facts, app.user_id, _job_terms(session, app.job_id))
    if not report.ok:
        raise ValidationFailed(report.messages())

    version = (
        session.scalar(
            select(func.coalesce(func.max(GeneratedDocument.doc_version), 0)).where(
                GeneratedDocument.application_id == app.id, GeneratedDocument.kind == kind
            )
        )
        + 1
    )
    doc = GeneratedDocument(
        application_id=app.id,
        kind=kind,
        doc_version=version,
        state=DocumentState.VALIDATED,
        prompt_version=prompt_version,
        model=model,
    )
    for position, claim in enumerate(draft.claims):
        doc.claims.append(
            Claim(
                body=claim.body,
                position=position,
                evidence=[ClaimEvidence(fact_id=f) for f in dict.fromkeys(claim.fact_ids)],
            )
        )
    session.add(doc)
    session.flush()

    status = AppStatus(app.status)
    if status == AppStatus.SHORTLISTED:
        lifecycle.transition(session, app, AppStatus.PREPARED, actor)
        status = AppStatus.PREPARED
    if status in _TO_REVIEW_FROM:
        note = "edited after approval" if status == AppStatus.APPROVED else None
        lifecycle.transition(session, app, AppStatus.AWAITING_APPROVAL, actor, note=note)
    return doc


def generate(session: Session, provider: LLMProvider, app: Application, kind: DocumentKind) -> GeneratedDocument:
    """Ask the model for cited claims, validate, retry with the validator's complaints, then escalate."""
    job = session.get(Job, app.job_id)
    company = session.get(Company, job.company_id)
    facts = list_facts(session, app.user_id, [FactStatus.VERIFIED])
    if not facts:
        raise DomainError("no verified facts yet; verify your profile first")

    requirements = requirement_views(session, job.id)
    evaluation = latest_evaluation(session, app.user_id, job.id)
    covered = set()
    if evaluation is not None:
        covered = {
            m.requirement_id
            for m in session.scalars(
                select(RequirementMatch).where(
                    RequirementMatch.evaluation_id == evaluation.id, RequirementMatch.coverage != Coverage.GAP
                )
            )
        }
    gaps = [r.statement for r in requirements if r.id not in covered] if evaluation else []

    issues: list[str] = []
    for _ in range(MAX_GENERATION_ATTEMPTS):
        prompt = prompts.build_prompt(
            kind,
            job.title,
            company.name,
            [(str(r.importance), r.statement) for r in requirements],
            gaps,
            [(str(f.id), f.statement) for f in facts],
            issues,
        )
        draft, error = call_structured(
            session,
            provider,
            DocumentDraft,
            purpose=f"generate.{kind}",
            prompt_version=prompts.PROMPT_VERSION,
            system=prompts.SYSTEM,
            prompt=prompt,
            contains_personal_data=True,
            user_id=app.user_id,
            application_id=app.id,
        )
        if draft is None:
            issues = [error or "invalid output"]
            continue
        try:
            return save_version(
                session, app, kind, draft, Actor.SYSTEM, prompt_version=prompts.PROMPT_VERSION, model=provider.model
            )
        except ValidationFailed as exc:
            issues = exc.issues

    note = f"generation failed validation {MAX_GENERATION_ATTEMPTS} times: " + "; ".join(issues)[:900]
    lifecycle.transition(session, app, AppStatus.NEEDS_MANUAL_INTERVENTION, Actor.SYSTEM, note=note)
    raise ValidationFailed(issues)


def prepare_screening_answers(
    session: Session, provider: LLMProvider, app: Application, questions: list[str]
) -> list[dict[str, str]]:
    """Draft answers for arbitrary custom screening questions, grounded in verified facts."""
    if not questions:
        return []
    job = session.get(Job, app.job_id)
    company = session.get(Company, job.company_id)
    facts = list_facts(session, app.user_id, [FactStatus.VERIFIED])
    if not facts:
        raise DomainError("no verified facts yet; verify your profile first")

    requirements = requirement_views(session, job.id)
    prompt = prompts.build_screening_prompt(
        job.title,
        company.name,
        [(str(r.importance), r.statement) for r in requirements],
        [(str(f.id), f.statement) for f in facts],
        questions,
    )
    draft, error = call_structured(
        session,
        provider,
        ScreeningDraft,
        purpose="generate.screening_questions",
        prompt_version=prompts.PROMPT_VERSION,
        system=prompts.SCREENING_SYSTEM,
        prompt=prompt,
        contains_personal_data=True,
        user_id=app.user_id,
        application_id=app.id,
    )
    if draft is None:
        raise DomainError(error or "failed to draft screening answers")
    return [{"question": a.question, "answer": a.answer} for a in draft.answers]


def approve(session: Session, app: Application, expected_lock_version: int) -> Application:
    """User approval. Re-validates against current facts inside the transaction (design 12.3)."""
    docs = latest_documents(session, app.id)
    if not docs:
        raise DomainError("nothing to approve: no documents")

    # Lock the cited facts so a concurrent revision cannot slip in between check and approval.
    cited = {e.fact_id for d in docs.values() for c in d.claims for e in c.evidence}
    session.execute(select(ProfileFact.id).where(ProfileFact.id.in_(cited)).with_for_update()).all()
    facts = load_fact_views(session, app.user_id, cited)
    terms = _job_terms(session, app.job_id)

    problems: list[str] = []
    for kind, doc in docs.items():
        drafts = [ClaimDraft(body=c.body, fact_ids=c.fact_ids) for c in doc.claims]
        report = validate_claims(drafts, facts, app.user_id, terms)
        problems += [f"{kind} v{doc.doc_version} {m}" for m in report.messages()]
    if problems:
        raise ValidationFailed(problems)

    lifecycle.transition(session, app, AppStatus.APPROVED, Actor.USER, expected_lock_version=expected_lock_version)
    for doc in docs.values():
        doc.state = DocumentState.APPROVED
    session.flush()
    return app


def approved_documents(session: Session, app: Application) -> dict[str, GeneratedDocument]:
    """The newest version of each document kind, if the user approved it."""
    return {k: d for k, d in latest_documents(session, app.id).items() if d.state == DocumentState.APPROVED}


@dataclass
class Packet:
    application_id: uuid.UUID
    job_title: str
    company: str
    documents: dict[str, list[str]]
    answers: dict[str, str]
    stale_answers: list[str]
    # question_key -> the question as the user wrote it; the extension matches form labels against these.
    questions: dict[str, str]


def packet(session: Session, app: Application) -> Packet:
    """The approved content the extension fills in (or the export renders). Approved apps only."""
    if app.status not in {AppStatus.APPROVED, AppStatus.SUBMISSION_IN_PROGRESS}:
        raise DomainError(f"application is {app.status}; only approved applications have a packet")
    job = session.get(Job, app.job_id)
    company = session.get(Company, job.company_id)
    docs = {k: [c.body for c in d.claims] for k, d in approved_documents(session, app).items()}
    entries = session.scalars(select(AnswerBankEntry).where(AnswerBankEntry.user_id == app.user_id)).all()
    return Packet(
        app.id,
        job.title,
        company.name,
        docs,
        {e.question_key: e.answer for e in entries},
        [e.question_key for e in entries if is_stale(e)],
        {e.question_key: e.question for e in entries},
    )
