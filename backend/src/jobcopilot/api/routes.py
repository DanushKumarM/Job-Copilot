import uuid

from fastapi import APIRouter, Cookie, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy import select

from jobcopilot import auth, worker
from jobcopilot.api import schemas as s
from jobcopilot.api.deps import LLMDep, SessionDep, UserDep
from jobcopilot.audit import analytics
from jobcopilot.config import get_settings
from jobcopilot.enums import Actor, AppStatus, DocumentKind, FactStatus
from jobcopilot.generation import render, service as generation
from jobcopilot.generation.models import GeneratedDocument
from jobcopilot.generation.validator import DocumentDraft
from jobcopilot.inbox import gmail, service as inbox
from jobcopilot.ingestion import service as ingestion
from jobcopilot.ingestion.adapters.base import NormalizedPosting
from jobcopilot.ingestion.adapters.greenhouse import GreenhouseAdapter
from jobcopilot.ingestion.adapters.lever import LeverAdapter
from jobcopilot.ingestion.models import Company, Job, JobPosting, JobRequirement, Source
from jobcopilot.lifecycle import service as lifecycle
from jobcopilot.lifecycle.models import Application, Evidence
from jobcopilot.lifecycle.state_machine import allowed_targets
from jobcopilot.llm.base import get_provider
from jobcopilot.matching import service as matching
from jobcopilot.matching.extraction import ExtractionUnavailable
from jobcopilot.matching.filters import Preferences
from jobcopilot.matching.models import RequirementMatch
from jobcopilot.profile import service as profile
from jobcopilot.profile.models import AnswerBankEntry, User

router = APIRouter()

ADAPTERS = {"greenhouse": GreenhouseAdapter, "lever": LeverAdapter}


# --- authentication ------------------------------------------------------------------------------


@router.post("/auth/register", response_model=s.AuthOut, status_code=201, tags=["auth"])
def register(body: s.RegisterIn, response: Response, session: SessionDep):
    email = auth.normalize_email(body.email)
    if session.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(409, "an account with that email already exists")
    user = User(email=email, preferences={}, password_hash=auth.hash_password(body.password))
    session.add(user)
    session.flush()
    token = auth.create_session(session, user)
    session.commit()
    response.set_cookie(
        auth.SESSION_COOKIE,
        token,
        max_age=auth.SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=get_settings().auth_cookie_secure,
    )
    return {"user": user}


@router.post("/auth/login", response_model=s.AuthOut, tags=["auth"])
def login(body: s.LoginIn, response: Response, session: SessionDep):
    email = auth.normalize_email(body.email)
    user = session.scalar(select(User).where(User.email == email))
    if user is None or not auth.verify_password(body.password, user.password_hash):
        raise HTTPException(401, "email or password is incorrect")
    token = auth.create_session(session, user)
    session.commit()
    response.set_cookie(
        auth.SESSION_COOKIE,
        token,
        max_age=auth.SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=get_settings().auth_cookie_secure,
    )
    return {"user": user}


@router.post("/auth/logout", status_code=204, tags=["auth"])
def logout(
    response: Response,
    session: SessionDep,
    session_cookie: str | None = Cookie(default=None, alias=auth.SESSION_COOKIE),
):
    auth.revoke_session(session, session_cookie)
    session.commit()
    response.delete_cookie(auth.SESSION_COOKIE)


@router.get("/auth/me", response_model=s.AuthOut, tags=["auth"])
def me(user: UserDep):
    return {"user": user}


# --- profile -------------------------------------------------------------------------------------


@router.post("/profile/resume", response_model=list[s.FactOut], tags=["profile"])
def import_resume(body: s.ResumeIn, session: SessionDep, user: UserDep):
    facts = profile.import_resume_text(session, user.id, body.text, body.file_name)
    session.commit()
    return facts


@router.get("/profile/facts", response_model=list[s.FactOut], tags=["profile"])
def list_facts(session: SessionDep, user: UserDep, status: FactStatus | None = None):
    return profile.list_facts(session, user.id, [status] if status else None)


@router.post("/profile/facts", response_model=s.FactOut, tags=["profile"])
def add_fact(body: s.FactIn, session: SessionDep, user: UserDep):
    fact = profile.propose_fact(session, user.id, body.kind, body.statement, body.details)
    session.commit()
    return fact


@router.post("/profile/facts/{fact_id}/verify", response_model=s.FactOut, tags=["profile"])
def verify_fact(fact_id: uuid.UUID, session: SessionDep, user: UserDep):
    fact = profile.verify_fact(session, user.id, fact_id)
    session.commit()
    worker.enqueue_rescore()
    return fact


@router.post("/profile/facts/{fact_id}/reject", response_model=s.FactOut, tags=["profile"])
def reject_fact(fact_id: uuid.UUID, session: SessionDep, user: UserDep):
    fact = profile.reject_fact(session, user.id, fact_id)
    session.commit()
    return fact


@router.post("/profile/facts/{fact_id}/revise", response_model=s.FactOut, tags=["profile"])
def revise_fact(fact_id: uuid.UUID, body: s.FactRevision, session: SessionDep, user: UserDep):
    fact = profile.revise_fact(session, user.id, fact_id, body.statement, body.details)
    session.commit()
    worker.enqueue_rescore()
    return fact


@router.get("/profile/preferences", response_model=Preferences, tags=["profile"])
def get_preferences(user: UserDep):
    return Preferences.model_validate(user.preferences or {})


@router.put("/profile/preferences", response_model=Preferences, tags=["profile"])
def put_preferences(body: Preferences, session: SessionDep, user: UserDep):
    user.preferences = body.model_dump(mode="json")
    session.commit()
    worker.enqueue_rescore()
    return body


@router.get("/profile/answers", response_model=list[s.AnswerOut], tags=["profile"])
def list_answers(session: SessionDep, user: UserDep):
    entries = session.scalars(select(AnswerBankEntry).where(AnswerBankEntry.user_id == user.id)).all()
    return [s.AnswerOut.model_validate(e).model_copy(update={"stale": profile.is_stale(e)}) for e in entries]


@router.put("/profile/answers/{question_key}", response_model=s.AnswerOut, tags=["profile"])
def put_answer(question_key: str, body: s.AnswerIn, session: SessionDep, user: UserDep):
    entry = profile.upsert_answer(session, user.id, question_key, body.question, body.answer)
    session.commit()
    return entry


# --- jobs ----------------------------------------------------------------------------------------


def _job_summary(session, user_id: uuid.UUID, job: Job) -> dict:
    company = session.get(Company, job.company_id)
    evaluation = matching.latest_evaluation(session, user_id, job.id)
    app = session.scalars(
        select(Application).where(Application.user_id == user_id, Application.job_id == job.id)
    ).one_or_none()
    return {
        "id": job.id,
        "title": job.title,
        "company": company.name,
        "location": job.location,
        "work_mode": job.work_mode,
        "freshness": job.freshness,
        "score": evaluation.score if evaluation else None,
        "application_id": app.id if app else None,
        "application_status": app.status if app else None,
    }


@router.post("/jobs", response_model=s.JobDetail, tags=["jobs"])
def paste_job(body: s.PastedJobIn, session: SessionDep, user: UserDep):
    """Ingest a pasted job description (FR4) and evaluate it straight away."""
    source = ingestion.manual_source(session, user.id)
    posting = NormalizedPosting(
        external_id=body.url or f"pasted:{uuid.uuid4()}",
        company=body.company,
        title=body.title,
        description=body.description,
        url=body.url,
        location=body.location,
        work_mode=body.work_mode,
        salary_min=body.salary_min,
        salary_max=body.salary_max,
        raw=body.model_dump(mode="json"),
    )
    result = ingestion.ingest(session, source, posting)
    matching.evaluate(session, user, result.job)
    session.commit()
    worker.enqueue_refinement()
    return get_job(result.job.id, session, user)


@router.get("/jobs", response_model=list[s.JobSummary], tags=["jobs"])
def list_jobs(session: SessionDep, user: UserDep, limit: int = 100):
    jobs = session.scalars(
        select(Job)
        .where(
            Job.id.in_(
                select(JobPosting.job_id)
                .join(Source, Source.id == JobPosting.source_id)
                .where(Source.user_id == user.id)
            )
        )
        .order_by(Job.last_seen_at.desc())
        .limit(limit)
    ).all()
    return [_job_summary(session, user.id, j) for j in jobs]


@router.get("/jobs/{job_id}", response_model=s.JobDetail, tags=["jobs"])
def get_job(job_id: uuid.UUID, session: SessionDep, user: UserDep):
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    evaluation = matching.latest_evaluation(session, user.id, job.id)
    matches = (
        session.scalars(select(RequirementMatch).where(RequirementMatch.evaluation_id == evaluation.id)).all()
        if evaluation
        else []
    )
    return {
        **_job_summary(session, user.id, job),
        "matches": matches,
        "description": job.description,
        "requirements": session.scalars(
            select(JobRequirement).where(JobRequirement.job_id == job.id, JobRequirement.retired_at.is_(None))
        ).all(),
        "extractor_version": job.extractor_version,
        "evaluation": evaluation,
        "postings": session.scalars(select(JobPosting).where(JobPosting.job_id == job.id)).all(),
    }


@router.post("/jobs/{job_id}/evaluate", response_model=s.EvaluationOut, tags=["jobs"])
def evaluate_job(job_id: uuid.UUID, session: SessionDep, user: UserDep):
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    evaluation = matching.evaluate(session, user, job)
    session.commit()
    return evaluation


@router.post("/jobs/{job_id}/extract", response_model=s.JobDetail, tags=["jobs"])
def extract_job_requirements(job_id: uuid.UUID, session: SessionDep, user: UserDep):
    """Re-extract this job's requirements with the model now, instead of waiting for the worker."""
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    if not job.description:
        raise HTTPException(409, "job has no description to extract requirements from")
    try:
        changed = matching.refine_requirements(session, get_provider(get_settings().extraction_provider), user, job)
    except ExtractionUnavailable as exc:
        raise HTTPException(502, str(exc)) from exc
    session.commit()
    if not changed:
        raise HTTPException(422, "the model gave no usable requirements; the rule-based ones are kept")
    return get_job(job.id, session, user)


@router.post("/postings/{posting_id}/split", response_model=s.JobDetail, tags=["jobs"])
def split_posting(posting_id: uuid.UUID, session: SessionDep, user: UserDep):
    job = ingestion.split_posting(session, user.id, posting_id)
    matching.evaluate(session, user, job)
    session.commit()
    return get_job(job.id, session, user)


@router.get("/sources", response_model=list[s.SourceOut], tags=["sources"])
def list_sources(session: SessionDep, user: UserDep):
    return session.scalars(select(Source).where(Source.user_id == user.id)).all()


@router.post("/sources", response_model=s.SourceOut, tags=["sources"])
def add_source(body: s.SourceIn, session: SessionDep, user: UserDep):
    adapter = ADAPTERS[body.kind]
    source = ingestion.ensure_source(session, user.id, body.kind, body.config, adapter.access_basis)
    session.commit()
    return source


@router.post("/sources/{source_id}/poll", response_model=list[s.JobSummary], tags=["sources"])
def poll_source(source_id: uuid.UUID, session: SessionDep, user: UserDep):
    source = session.get(Source, source_id)
    if source is None or source.user_id != user.id or source.kind not in ADAPTERS:
        raise HTTPException(404, "pollable source not found")
    try:
        results = ingestion.poll_board(session, source, ADAPTERS[source.kind]())
    except Exception as exc:  # noqa: BLE001 - keep the health/audit record, report upstream failure
        session.commit()
        raise HTTPException(502, f"fetching {source.kind} board failed: {exc}") from exc
    for result in results:
        if result.new_job:
            matching.evaluate(session, user, result.job)
    session.commit()
    worker.enqueue_refinement()
    return [_job_summary(session, user.id, r.job) for r in results]


# --- applications --------------------------------------------------------------------------------


def _documents(session, application_id: uuid.UUID) -> list[dict]:
    docs = session.scalars(
        select(GeneratedDocument)
        .where(GeneratedDocument.application_id == application_id)
        .order_by(GeneratedDocument.kind, GeneratedDocument.doc_version)
    ).all()
    return [
        {
            "id": d.id,
            "kind": d.kind,
            "doc_version": d.doc_version,
            "state": d.state,
            "model": d.model,
            "claims": [{"body": c.body, "fact_ids": c.fact_ids} for c in d.claims],
        }
        for d in docs
    ]


def _application_summary(session, app: Application) -> dict:
    job = session.get(Job, app.job_id)
    evaluation = matching.latest_evaluation(session, app.user_id, job.id)
    url = session.scalar(
        select(JobPosting.url).where(JobPosting.job_id == job.id, JobPosting.url.is_not(None)).limit(1)
    )
    return {
        **s.ApplicationOut.model_validate(app).model_dump(),
        "job_title": job.title,
        "company": session.get(Company, job.company_id).name,
        "score": evaluation.score if evaluation else None,
        "job_url": url,
    }


@router.get("/applications", response_model=list[s.ApplicationSummary], tags=["applications"])
def list_applications(session: SessionDep, user: UserDep, status: AppStatus | None = None):
    query = select(Application).where(Application.user_id == user.id).order_by(Application.updated_at.desc())
    if status:
        query = query.where(Application.status == status)
    return [_application_summary(session, a) for a in session.scalars(query)]


@router.get("/applications/{application_id}", response_model=s.ApplicationDetail, tags=["applications"])
def get_application(application_id: uuid.UUID, session: SessionDep, user: UserDep):
    app = lifecycle.get_application(session, user.id, application_id)
    evidence = session.scalars(
        select(Evidence).where(Evidence.application_id == app.id).order_by(Evidence.created_at)
    ).all()
    return {
        **_application_summary(session, app),
        "documents": _documents(session, app.id),
        "history": lifecycle.history(session, app.id),
        "evidence": evidence,
        "allowed_targets": sorted(allowed_targets(AppStatus(app.status))),
    }


@router.post("/jobs/{job_id}/application", response_model=s.ApplicationOut, tags=["applications"])
def shortlist(job_id: uuid.UUID, session: SessionDep, user: UserDep):
    """The user picks a job by hand: create its application and shortlist it."""
    if session.get(Job, job_id) is None:
        raise HTTPException(404, "job not found")
    app, _ = lifecycle.get_or_create_application(session, user.id, job_id)
    if app.status in {AppStatus.DISCOVERED, AppStatus.REJECTED_BY_RULES}:
        lifecycle.transition(session, app, AppStatus.SHORTLISTED, Actor.USER)
    session.commit()
    return app


@router.post("/applications/{application_id}/transition", response_model=s.ApplicationOut, tags=["applications"])
def transition(application_id: uuid.UUID, body: s.TransitionIn, session: SessionDep, user: UserDep):
    app = lifecycle.get_application(session, user.id, application_id)
    lifecycle.transition(session, app, body.target, Actor.USER, expected_lock_version=body.lock_version, note=body.note)
    session.commit()
    return app


@router.post("/applications/{application_id}/generate", response_model=s.DocumentOut, tags=["applications"])
def generate(application_id: uuid.UUID, body: s.GenerateIn, session: SessionDep, user: UserDep, llm: LLMDep):
    app = lifecycle.get_application(session, user.id, application_id)
    try:
        doc = generation.generate(session, llm, app, body.kind)
    except Exception:
        # Keep the escalation to the manual queue and the LLM call log even when generation fails.
        session.commit()
        raise
    session.commit()
    return next(d for d in _documents(session, app.id) if d["id"] == doc.id)


@router.put("/applications/{application_id}/documents/{kind}", response_model=s.DocumentOut, tags=["applications"])
def save_document(
    application_id: uuid.UUID, kind: DocumentKind, body: s.DocumentIn, session: SessionDep, user: UserDep
):
    """Save the user's edit as a new version (FR18). Rejected with 422 if any claim is unsupported."""
    app = lifecycle.get_application(session, user.id, application_id)
    doc = generation.save_version(session, app, kind, DocumentDraft(claims=body.claims), Actor.USER)
    session.commit()
    return next(d for d in _documents(session, app.id) if d["id"] == doc.id)


@router.post("/applications/{application_id}/approve", response_model=s.ApplicationOut, tags=["applications"])
def approve(application_id: uuid.UUID, body: s.ApproveIn, session: SessionDep, user: UserDep):
    app = lifecycle.get_application(session, user.id, application_id)
    generation.approve(session, app, body.lock_version)
    session.commit()
    return app


@router.get("/applications/{application_id}/packet", response_model=s.PacketOut, tags=["extension"])
def get_packet(application_id: uuid.UUID, session: SessionDep, user: UserDep):
    app = lifecycle.get_application(session, user.id, application_id)
    return generation.packet(session, app).__dict__


@router.get("/applications/{application_id}/resume.pdf", response_class=FileResponse, tags=["extension"])
def resume_pdf(application_id: uuid.UUID, session: SessionDep, user: UserDep):
    """The tailored resume, rendered from the approved documents (FR21)."""
    app = lifecycle.get_application(session, user.id, application_id)
    path = render.render_resume(session, app)
    session.commit()
    return FileResponse(path, media_type="application/pdf", filename=_pdf_name(session, app, "resume"))


@router.get("/applications/{application_id}/answers.pdf", response_class=FileResponse, tags=["applications"])
def answers_pdf(application_id: uuid.UUID, session: SessionDep, user: UserDep):
    """Answers sheet for sites the extension does not support: contact details, answers, cover letter."""
    app = lifecycle.get_application(session, user.id, application_id)
    path = render.render_answers(session, app)
    return FileResponse(path, media_type="application/pdf", filename=_pdf_name(session, app, "answers"))


def _pdf_name(session, app: Application, kind: str) -> str:
    job = session.get(Job, app.job_id)
    company = session.get(Company, job.company_id).name
    slug = "-".join("".join(c if c.isalnum() else " " for c in f"{company} {job.title}").lower().split())
    return f"{kind}-{slug[:60]}.pdf"


@router.get("/extension/lookup", response_model=s.ExtensionLookup, tags=["extension"])
def extension_lookup(url: str, session: SessionDep, user: UserDep):
    """Which application a job or application page belongs to. 404 if the job is not in job-copilot."""
    posting = ingestion.posting_for_url(session, user.id, url)
    if posting is None:
        raise HTTPException(404, "no job in job-copilot matches this page")
    app, _ = lifecycle.get_or_create_application(session, user.id, posting.job_id)
    session.commit()
    return {
        "application": _application_summary(session, app),
        "adapter": ingestion.adapter_for_url(url),
        "packet_ready": app.status in {AppStatus.APPROVED, AppStatus.SUBMISSION_IN_PROGRESS},
    }


@router.post("/applications/{application_id}/evidence", response_model=s.EvidenceResult, tags=["extension"])
def add_evidence(application_id: uuid.UUID, body: s.EvidenceIn, session: SessionDep, user: UserDep):
    """Submission attempts and confirmation pages from the extension; manual notes from the console."""
    app = lifecycle.get_application(session, user.id, application_id)
    outcome = lifecycle.apply_evidence(
        session, app, body.kind, body.external_ref, Actor.EXTENSION, body.extracted, body.confidence
    )
    session.commit()
    return {"action": outcome.action, "application": app}


@router.get("/queue", response_model=list[s.ApplicationSummary], tags=["applications"])
def manual_queue(session: SessionDep, user: UserDep):
    return list_applications(session, user, AppStatus.NEEDS_MANUAL_INTERVENTION)


@router.get("/analytics/funnel", tags=["analytics"])
def funnel(session: SessionDep, user: UserDep) -> dict:
    return analytics.funnel(session, user.id)


# --- inbox ---------------------------------------------------------------------------------------


@router.get("/inbox/status", response_model=s.InboxStatus, tags=["inbox"])
def inbox_status(session: SessionDep, user: UserDep):
    source = session.scalars(
        select(Source).where(Source.user_id == user.id, Source.kind == inbox.GMAIL_SOURCE_KIND)
    ).first()
    return {
        "gmail_connected": gmail.is_authorized(user.email),
        "last_synced_at": source.last_polled_at if source else None,
        "unresolved": len(inbox.unresolved(session, user.id)),
    }


@router.post("/inbox/sync", status_code=202, tags=["inbox"])
def sync_inbox_now(user: UserDep) -> dict:
    """Queue an inbox sync for the worker (it also runs every 15 minutes)."""
    try:
        worker.sync_inbox.defer(timestamp=0)
    except worker.AlreadyEnqueued:
        pass
    return {"queued": True}


@router.get("/inbox", response_model=list[s.InboundMessageOut], tags=["inbox"])
def inbox_queue(session: SessionDep, user: UserDep):
    """Emails that need a decision: no matching application found, or not confident enough."""
    return inbox.unresolved(session, user.id)


@router.post("/inbox/{message_id}/assign", response_model=s.ApplicationOut, tags=["inbox"])
def assign_message(message_id: uuid.UUID, body: s.AssignIn, session: SessionDep, user: UserDep):
    app = inbox.assign(session, user.id, message_id, body.application_id, body.classification)
    session.commit()
    return app


@router.post("/inbox/{message_id}/import", response_model=s.ApplicationOut, tags=["inbox"])
def import_message(message_id: uuid.UUID, body: s.ImportIn, session: SessionDep, user: UserDep):
    """Track an application made outside job-copilot, starting from its email."""
    app = inbox.import_message(
        session, user.id, message_id, body.company, body.title, body.location, body.classification
    )
    session.commit()
    return app


@router.post("/inbox/{message_id}/dismiss", response_model=s.InboundMessageOut, tags=["inbox"])
def dismiss_message(message_id: uuid.UUID, session: SessionDep, user: UserDep):
    record = inbox.dismiss(session, user.id, message_id)
    session.commit()
    return record


# --- settings ------------------------------------------------------------------------------------


@router.get("/status", response_model=s.StatusOut, tags=["settings"])
def status(user: UserDep):
    settings = get_settings()
    model = {
        "ollama": settings.ollama_model,
        "gemini": settings.gemini_model,
        "hosted": settings.hosted_llm_model,
    }.get(settings.llm_provider, "")
    return {
        "llm_provider": settings.llm_provider,
        "llm_model": model,
        "requirement_extractor": settings.requirement_extractor,
        "extraction_provider": settings.extraction_provider,
        "gmail_connected": gmail.is_authorized(user.email),
        "contact_fields": profile.CONTACT_FIELDS,
    }
