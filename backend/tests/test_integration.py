"""End-to-end against PostgreSQL: the worked example from design section 4.2, plus the guarantees
that only the database can give (append-only history, idempotency, optimistic locking, erasure)."""

import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import DBAPIError

from jobcopilot.enums import Actor, AppStatus, Coverage, DocumentKind, EvidenceKind, FactKind, FactStatus
from jobcopilot.errors import ConcurrentModification, InvalidTransition, ValidationFailed
from jobcopilot.generation import service as generation
from jobcopilot.generation.validator import ClaimDraft, DocumentDraft
from jobcopilot.ingestion import service as ingestion
from jobcopilot.ingestion.adapters import greenhouse, lever
from jobcopilot.lifecycle import service as lifecycle
from jobcopilot.lifecycle.models import Application, ApplicationEvent
from jobcopilot.llm.base import LLMResponse
from jobcopilot.matching import service as matching
from jobcopilot.matching.models import RequirementMatch
from jobcopilot.models import AuditLog, LLMCall, ProfileFact
from jobcopilot.profile import service as profile

FIXTURES = Path(__file__).parent / "fixtures"

RESUME = """Asha Rao — Backend Engineer
4 years of professional experience building backend systems
Skills: Python, PostgreSQL, Docker, REST APIs
- Built billing services in Python handling 2 million invoices a month
- Designed PostgreSQL schemas and REST APIs for the payments platform
"""


class FakeAdapter:
    kind, access_basis = "fake", "test"

    def __init__(self, postings):
        self.postings = postings

    def fetch(self, config):
        return self.postings


def gh_postings():
    return greenhouse.parse(json.loads((FIXTURES / "greenhouse_acme.json").read_text()), company="acme")


def lever_postings():
    return lever.parse(json.loads((FIXTURES / "lever_acme.json").read_text()), company="Acme")


@pytest.fixture
def user(session):
    user = profile.get_or_create_user(session, f"{uuid.uuid4().hex[:8]}@example.com")
    user.preferences = {"locations": ["Bengaluru"], "title_exclude": ["intern"]}
    for fact in profile.import_resume_text(session, user.id, RESUME, "resume.txt"):
        profile.verify_fact(session, user.id, fact.id)
    return user


def backend_job(session, user):
    source = ingestion.ensure_source(
        session, user.id, "greenhouse", {"board_token": "acme"}, "public ATS job-board API"
    )
    results = ingestion.poll_board(session, source, FakeAdapter(gh_postings()))
    return next(r.job for r in results if r.job.title == "Backend Engineer")


# --- profile -------------------------------------------------------------------------------------


def test_resume_import_proposes_facts_that_need_verification(session):
    user = profile.get_or_create_user(session, "new@example.com")
    facts = profile.import_resume_text(session, user.id, RESUME, "resume.txt")
    assert {f.status for f in facts} == {FactStatus.PROPOSED}
    kinds = [f.kind for f in facts]
    assert kinds.count(FactKind.SKILL) == 4  # python, postgresql, docker, rest
    assert any(f.details.get("total_years") == 4 for f in facts)


def test_revising_a_fact_supersedes_it(session, user):
    old = next(f for f in profile.list_facts(session, user.id) if "billing" in f.statement)
    new = profile.revise_fact(
        session, user.id, old.id, "Built billing services in Python handling 3 million invoices a month"
    )
    assert old.status == FactStatus.SUPERSEDED and old.superseded_by == new.id
    assert new.status == FactStatus.VERIFIED


# --- ingestion -----------------------------------------------------------------------------------


def test_same_role_from_two_sources_merges_into_one_job(session, user):
    job = backend_job(session, user)
    lever_source = ingestion.ensure_source(session, user.id, "lever", {"site": "acme"}, "public ATS job-board API")
    [result] = ingestion.poll_board(session, lever_source, FakeAdapter(lever_postings()))
    assert result.job.id == job.id and not result.new_job
    assert job.salary_max == 3_500_000  # filled in from the second source
    assert not result.needs_review


def test_repoll_is_idempotent_and_vanished_jobs_close(session, user):
    source = ingestion.ensure_source(
        session, user.id, "greenhouse", {"board_token": "acme"}, "public ATS job-board API"
    )
    first = ingestion.poll_board(session, source, FakeAdapter(gh_postings()))
    second = ingestion.poll_board(session, source, FakeAdapter(gh_postings()[:1]))
    assert not any(r.new_posting for r in second)
    frontend = next(r.job for r in first if "Frontend" in r.job.title)
    session.refresh(frontend)
    assert frontend.freshness == "closed"


def test_split_undoes_a_false_merge(session, user):
    job = backend_job(session, user)
    lever_source = ingestion.ensure_source(session, user.id, "lever", {"site": "acme"}, "public ATS job-board API")
    [result] = ingestion.poll_board(session, lever_source, FakeAdapter(lever_postings()))
    new_job = ingestion.split_posting(session, user.id, result.posting.id)
    assert new_job.id != job.id and result.posting.job_id == new_job.id


# --- worked example (design 4.2) -----------------------------------------------------------------


def test_worked_example_end_to_end(session, user):
    job = backend_job(session, user)

    evaluation = matching.evaluate(session, user, job)
    assert evaluation.hard_filter_pass
    coverage = {
        m.requirement_id: m.coverage
        for m in session.scalars(select(RequirementMatch).where(RequirementMatch.evaluation_id == evaluation.id))
    }
    kafka = next(r for r in matching.requirement_views(session, job.id) if r.terms == ["kafka"])
    assert coverage[kafka.id] == Coverage.GAP
    assert evaluation.score == 70 and evaluation.breakdown["must_gaps"] == 0

    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    assert app.status == AppStatus.SHORTLISTED

    facts = {f.statement: f.id for f in profile.list_facts(session, user.id)}
    billing = next(i for s, i in facts.items() if "billing" in s)
    schemas = next(i for s, i in facts.items() if "schemas" in s)

    # A bullet claiming Kafka is rejected before review, and nothing is stored.
    with pytest.raises(ValidationFailed, match="kafka"):
        generation.save_version(
            session,
            app,
            DocumentKind.RESUME_BULLETS,
            DocumentDraft(claims=[ClaimDraft(body="Built Kafka pipelines for billing in Python", fact_ids=[billing])]),
            Actor.SYSTEM,
        )
    assert app.status == AppStatus.SHORTLISTED

    generation.save_version(
        session,
        app,
        DocumentKind.RESUME_BULLETS,
        DocumentDraft(
            claims=[
                ClaimDraft(
                    body="Built Python billing services handling 2 million invoices a month", fact_ids=[billing]
                ),
                ClaimDraft(body="Designed PostgreSQL schemas and REST APIs for payments", fact_ids=[schemas]),
            ]
        ),
        Actor.SYSTEM,
    )
    assert app.status == AppStatus.AWAITING_APPROVAL

    generation.approve(session, app, app.lock_version)
    assert app.status == AppStatus.APPROVED
    assert generation.packet(session, app).documents["resume_bullets"][0].startswith("Built Python")

    lifecycle.transition(session, app, AppStatus.SUBMISSION_IN_PROGRESS, Actor.EXTENSION)
    out = lifecycle.apply_evidence(session, app, EvidenceKind.CONFIRMATION_PAGE, "page:sha256:abc", Actor.EXTENSION)
    assert out.action == "transitioned" and app.status == AppStatus.SUBMISSION_CONFIRMED
    assert app.confirmed_at is not None and app.submitted_at is not None

    # The "thanks for applying" email arrives afterwards: attached as evidence, no status change.
    out = lifecycle.apply_evidence(session, app, EvidenceKind.CONFIRMATION_EMAIL, "gmail:111", Actor.EMAIL)
    assert out.action == "attached" and app.status == AppStatus.SUBMISSION_CONFIRMED
    # Same email processed twice: no-op.
    assert (
        lifecycle.apply_evidence(session, app, EvidenceKind.CONFIRMATION_EMAIL, "gmail:111", Actor.EMAIL).action
        == "duplicate"
    )

    lifecycle.apply_evidence(session, app, EvidenceKind.REJECTION_EMAIL, "gmail:222", Actor.EMAIL)
    assert app.status == AppStatus.REJECTED

    statuses = [e.to_status for e in lifecycle.history(session, app.id)]
    assert statuses == [
        "discovered",
        "shortlisted",
        "prepared",
        "awaiting_approval",
        "approved",
        "submission_in_progress",
        "submission_confirmed",
        "submission_confirmed",
        "rejected",
    ]


def test_approval_fails_if_a_cited_fact_was_superseded(session, user):
    job = backend_job(session, user)
    matching.evaluate(session, user, job)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    billing = next(f for f in profile.list_facts(session, user.id) if "billing" in f.statement)
    generation.save_version(
        session,
        app,
        DocumentKind.RESUME_BULLETS,
        DocumentDraft(claims=[ClaimDraft(body="Built Python billing services", fact_ids=[billing.id])]),
        Actor.SYSTEM,
    )
    profile.revise_fact(session, user.id, billing.id, "Built billing services in Go")
    with pytest.raises(ValidationFailed, match="superseded"):
        generation.approve(session, app, app.lock_version)


def test_low_confidence_or_misfit_evidence_goes_to_manual_queue(session, user):
    job = backend_job(session, user)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    out = lifecycle.apply_evidence(session, app, EvidenceKind.INTERVIEW_EMAIL, "gmail:333", Actor.EMAIL, confidence=0.5)
    assert out.action == "needs_review" and app.status == AppStatus.NEEDS_MANUAL_INTERVENTION
    assert app.confirmed_at is None


# --- generation with a model ---------------------------------------------------------------------


class ScriptedLLM:
    name, model, allows_personal_data, billable = "fake", "fake-1", True, False

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.prompts = []

    def complete_json(self, system, prompt, schema):
        self.prompts.append(prompt)
        return LLMResponse(self.outputs.pop(0), input_tokens=100, output_tokens=50)


def test_generation_retries_with_validator_feedback(session, user):
    job = backend_job(session, user)
    matching.evaluate(session, user, job)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    billing = next(f for f in profile.list_facts(session, user.id) if "billing" in f.statement)
    bad = json.dumps({"claims": [{"body": "Ran Kafka at scale", "fact_ids": [str(billing.id)]}]})
    good = json.dumps({"claims": [{"body": "Built Python billing services", "fact_ids": [str(billing.id)]}]})
    llm = ScriptedLLM(["not json", bad, good])

    doc = generation.generate(session, llm, app, DocumentKind.RESUME_BULLETS)
    assert doc.doc_version == 1 and app.status == AppStatus.AWAITING_APPROVAL
    assert "kafka" in llm.prompts[2] and "Kafka" not in llm.prompts[0].split("Verified facts")[1]
    calls = session.scalars(select(LLMCall).where(LLMCall.application_id == app.id)).all()
    assert [c.outcome for c in calls] == ["invalid_output", "ok", "ok"]
    assert all(len(c.prompt_hash) == 64 for c in calls)


def test_generation_escalates_after_repeated_failures(session, user):
    job = backend_job(session, user)
    matching.evaluate(session, user, job)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    with pytest.raises(ValidationFailed):
        generation.generate(session, ScriptedLLM(["{}"] * 3), app, DocumentKind.RESUME_BULLETS)
    assert app.status == AppStatus.NEEDS_MANUAL_INTERVENTION


# --- database guarantees -------------------------------------------------------------------------


def test_stale_lock_version_is_rejected(session, user):
    job = backend_job(session, user)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    stale = app.lock_version
    lifecycle.transition(session, app, AppStatus.SHORTLISTED, Actor.USER)
    with pytest.raises(ConcurrentModification):
        lifecycle.transition(session, app, AppStatus.WITHDRAWN, Actor.USER, expected_lock_version=stale)


def test_confirmation_without_evidence_is_impossible(session, user):
    job = backend_job(session, user)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    with pytest.raises(InvalidTransition):
        lifecycle.transition(session, app, AppStatus.SUBMISSION_CONFIRMED, Actor.USER)


def test_event_log_is_append_only(session, user):
    job = backend_job(session, user)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    for statement in (update(ApplicationEvent).values(note="tampered"), delete(ApplicationEvent)):
        with pytest.raises(DBAPIError, match="append-only"), session.begin_nested():
            session.execute(statement.where(ApplicationEvent.application_id == app.id))


def test_deleting_a_user_erases_their_data(session, user):
    job = backend_job(session, user)
    matching.evaluate(session, user, job)
    user_id = user.id
    app_id = session.scalars(select(Application.id).where(Application.user_id == user_id)).one()
    session.delete(user)
    session.flush()
    for model in (Application, ProfileFact, AuditLog):
        assert session.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) == 0
    # The append-only guard lets the cascade through, and only the cascade.
    events = text("SELECT count(*) FROM application_events WHERE application_id = :id")
    assert session.scalar(events, {"id": app_id}) == 0
