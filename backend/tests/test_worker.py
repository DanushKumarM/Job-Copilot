"""Inbox sync and worker tasks against PostgreSQL."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from test_integration import RESUME, FakeAdapter

from jobcopilot import worker
from jobcopilot.enums import Actor, AppStatus, MessageClass
from jobcopilot.inbox import service as inbox
from jobcopilot.inbox.message import EmailMessage
from jobcopilot.ingestion import service as ingestion
from jobcopilot.ingestion.adapters.base import NormalizedPosting
from jobcopilot.ingestion.models import Job, JobPosting, JobRequirement
from jobcopilot.lifecycle import service as lifecycle
from jobcopilot.lifecycle.models import Application, InboundMessage
from jobcopilot.matching import service as matching
from jobcopilot.profile import service as profile

JD = "Requirements\n- 3+ years of professional experience\n- Python\n- PostgreSQL"


class FakeMail:
    def __init__(self, *messages: EmailMessage):
        self.messages = {m.id: m for m in messages}
        self.queries: list[int] = []
        self.fetched: list[str] = []

    def message_ids(self, after_epoch: int):
        self.queries.append(after_epoch)
        return iter(list(self.messages))

    def get(self, message_id: str) -> EmailMessage:
        self.fetched.append(message_id)
        return self.messages[message_id]


def mail(
    subject: str, body: str = "", sender: str = "no-reply@greenhouse.io", html: str = "", minutes_ago: int = 0
) -> EmailMessage:
    received = datetime.now(UTC) - timedelta(minutes=minutes_ago)
    return EmailMessage(uuid.uuid4().hex, "Hiring", sender, subject, received, body, html)


@pytest.fixture
def user(session):
    user = profile.get_or_create_user(session, f"{uuid.uuid4().hex[:8]}@example.com")
    for fact in profile.import_resume_text(session, user.id, RESUME, "resume.txt"):
        profile.verify_fact(session, user.id, fact.id)
    return user


def submitted(session, user, company: str, title: str):
    """An application the user has already sent, awaiting an answer."""
    source = ingestion.manual_source(session, user.id)
    posting = NormalizedPosting(f"pasted:{uuid.uuid4()}", company, title, JD, location="Bengaluru")
    job = ingestion.ingest(session, source, posting).job
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    for status in (
        AppStatus.SHORTLISTED,
        AppStatus.PREPARED,
        AppStatus.AWAITING_APPROVAL,
        AppStatus.APPROVED,
        AppStatus.SUBMITTED_UNCONFIRMED,
    ):
        lifecycle.transition(session, app, status, Actor.USER)
    return app


def test_sync_places_emails_and_is_idempotent(session, user):
    acme = submitted(session, user, "Acme", "Backend Engineer")
    globex = submitted(session, user, "Globex", "Data Engineer")
    confirmation = mail("Thank you for applying to Acme", "We received your application for Backend Engineer.")
    rejection = mail(
        "Your application to Globex", "Unfortunately, we will not be moving forward.", sender="talent@globex.com"
    )
    stranger = mail("Thanks for applying to Initech", "We have received your application.")
    alert = mail("12 new jobs for Backend Engineer", "Jobs you may be interested in")
    inbox_mail = FakeMail(confirmation, rejection, stranger, alert)

    report = worker.run_inbox_sync(session, user, inbox_mail)
    assert report.fetched == 4
    assert acme.status == AppStatus.SUBMISSION_CONFIRMED and acme.confirmed_at is not None
    assert globex.status == AppStatus.REJECTED and globex.confirmed_at is not None

    queue = inbox.unresolved(session, user.id)
    assert [m.extracted["subject"] for m in queue] == [stranger.subject]
    stored = session.scalars(select(InboundMessage).where(InboundMessage.user_id == user.id)).all()
    assert len(stored) == 4 and all("body" not in m.extracted for m in stored)

    # Second run: everything is known, nothing is fetched again, and the cursor moved forward.
    again = worker.run_inbox_sync(session, user, inbox_mail)
    assert again.fetched == 0 and again.skipped_known == 4 and len(inbox_mail.fetched) == 4
    assert inbox_mail.queries[1] > inbox_mail.queries[0]


def ambiguous_interview(session, user):
    backend = submitted(session, user, "Acme", "Backend Engineer")
    frontend = submitted(session, user, "Acme", "Senior Frontend Engineer")
    message = mail("Interview invitation from Acme", "Please share your availability for an interview.")
    worker.run_inbox_sync(session, user, FakeMail(message))
    [record] = inbox.unresolved(session, user.id)
    guessed = lifecycle.get_application(session, user.id, record.application_id)
    other = frontend if guessed.id == backend.id else backend
    return record, guessed, other


def test_ambiguous_email_parks_the_best_guess(session, user):
    record, guessed, other = ambiguous_interview(session, user)
    assert guessed.status == AppStatus.NEEDS_MANUAL_INTERVENTION
    assert other.status == AppStatus.SUBMITTED_UNCONFIRMED

    inbox.assign(session, user.id, record.id, guessed.id)
    assert guessed.status == AppStatus.INTERVIEW and not inbox.unresolved(session, user.id)


def test_reassigning_releases_the_wrong_guess(session, user):
    record, guessed, other = ambiguous_interview(session, user)
    inbox.assign(session, user.id, record.id, other.id)
    session.refresh(guessed)
    assert other.status == AppStatus.INTERVIEW
    assert guessed.status == AppStatus.SUBMITTED_UNCONFIRMED  # back where it was


def test_dismissing_releases_the_parked_application(session, user):
    record, guessed, _ = ambiguous_interview(session, user)
    inbox.dismiss(session, user.id, record.id)
    session.refresh(guessed)
    assert guessed.status == AppStatus.SUBMITTED_UNCONFIRMED and not inbox.unresolved(session, user.id)


def test_unmatched_email_can_be_assigned_with_corrected_class(session, user):
    app = submitted(session, user, "Acme", "Backend Engineer")
    # Sent from the ATS with no company name anywhere: cannot be matched automatically.
    unknown = mail("Thank you for applying", "We have received your application.", sender="no-reply@myworkday.com")
    worker.run_inbox_sync(session, user, FakeMail(unknown))
    [message] = inbox.unresolved(session, user.id)
    assert message.application_id is None and message.classification == MessageClass.CONFIRMATION
    # The user knows better: it is the interview invite for the Acme role.
    inbox.assign(session, user.id, message.id, app.id, MessageClass.INTERVIEW)
    assert app.status == AppStatus.INTERVIEW and app.confirmed_at is not None


def test_rescore_rescues_jobs_after_preferences_loosen(session, user):
    user.preferences = {"locations": ["Pune"]}
    source = ingestion.manual_source(session, user.id)
    job = ingestion.ingest(
        session, source, NormalizedPosting("x", "Acme", "Backend Engineer", JD, location="Bengaluru")
    ).job
    matching.evaluate(session, user, job)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    assert app.status == AppStatus.REJECTED_BY_RULES

    user.preferences = {"locations": ["Pune", "Bengaluru"]}
    assert worker.run_rescore(session, user) == 1
    session.refresh(app)
    assert app.status == AppStatus.SHORTLISTED


def test_board_polls_continue_past_a_failing_board(session, user):
    ingestion.ensure_source(session, user.id, "broken", {"board_token": "x"}, "test")
    ingestion.ensure_source(session, user.id, "fake", {"board_token": "y"}, "test")

    class Broken:
        def fetch(self, config):
            raise RuntimeError("board down")

    good = FakeAdapter([NormalizedPosting("1", "Acme", "Backend Engineer", JD, location="Bengaluru")])
    result = worker.run_board_polls(session, user, {"broken": Broken, "fake": lambda: good})
    assert list(result.values()) == [1]


def test_tasks_are_scheduled_and_rescore_requests_collapse(queue):
    crons = {t.task.name.rsplit(".", 1)[1]: t.cron for t in worker.app.periodic_registry.periodic_tasks.values()}
    assert crons == {
        "sync_inbox": "*/15 * * * *",
        "poll_boards": "0 */6 * * *",
        "mark_stale": "30 3 * * *",
        "refine_requirements": "*/30 * * * *",
    }

    worker.enqueue_rescore()
    worker.enqueue_rescore()
    assert [j["task_name"] for j in queue.jobs.values()] == ["jobcopilot.worker.rescore_open_jobs"]


def test_refinement_is_queued_only_when_model_extraction_is_on(queue, monkeypatch):
    from jobcopilot.config import get_settings

    worker.enqueue_refinement()
    assert not queue.jobs
    monkeypatch.setenv("JOBCOPILOT_REQUIREMENT_EXTRACTOR", "llm")
    get_settings.cache_clear()
    worker.enqueue_refinement()
    worker.enqueue_refinement()
    assert [j["task_name"] for j in queue.jobs.values()] == ["jobcopilot.worker.refine_requirements"]


def test_job_alert_becomes_jobs_and_a_board_posting_fills_them_in(session, user):
    from test_alerts_external import LINKEDIN_HTML

    alert = mail("Backend Engineer and more", sender="jobalerts-noreply@linkedin.com", html=LINKEDIN_HTML)
    report = worker.run_inbox_sync(session, user, FakeMail(alert))
    assert report.actions["alert_parsed"] == 1
    [record] = session.scalars(select(InboundMessage).where(InboundMessage.user_id == user.id)).all()
    assert record.extracted["jobs"] == 2 and record.resolved_at is not None and not inbox.unresolved(session, user.id)

    posting = session.scalars(select(JobPosting).where(JobPosting.external_id == "linkedin:3901234567")).one()
    job = session.get(Job, posting.job_id)
    assert job.description == "" and posting.url == "https://www.linkedin.com/jobs/view/3901234567/"
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    assert app.status == AppStatus.DISCOVERED  # nothing to score until a description arrives

    # The same role on the company's board merges into the alert's job and brings the description.
    board = ingestion.ensure_source(session, user.id, "fake", {"board_token": "acme"}, "test")
    full = NormalizedPosting("gh-1", "Acme Technologies", "Backend Engineer", JD, location="Bengaluru")
    worker.run_board_polls(session, user, {"fake": lambda: FakeAdapter([full])})
    assert session.scalars(select(JobPosting).where(JobPosting.job_id == job.id)).all().__len__() == 2
    assert session.scalars(select(JobRequirement).where(JobRequirement.job_id == job.id)).all()
    session.refresh(app)
    assert app.status == AppStatus.SHORTLISTED
    assert board.health == "ok"


def test_off_system_application_is_imported_and_followed(session, user):
    # Naukri NEO applied on the user's behalf; job-copilot had never seen the job.
    confirmation = mail(
        "Your application for Backend Developer at Hooli has been sent", sender="info@naukri.com", minutes_ago=60
    )
    rejection = mail(
        "Update from Hooli",
        "Unfortunately, we will not be moving forward with your application.",
        sender="careers@hooli.com",
    )
    # Gmail lists newest first; the sync still handles the confirmation before the rejection.
    report = worker.run_inbox_sync(session, user, FakeMail(rejection, confirmation))
    assert report.actions["imported"] == 1 and report.actions["transitioned"] == 1

    app = session.scalars(select(Application).where(Application.user_id == user.id)).one()
    assert app.status == AppStatus.REJECTED and app.confirmed_at is not None
    events = [(e.from_status, e.to_status) for e in lifecycle.history(session, app.id)]
    assert events == [
        (None, AppStatus.DISCOVERED),
        (AppStatus.DISCOVERED, AppStatus.SUBMISSION_CONFIRMED),
        (AppStatus.SUBMISSION_CONFIRMED, AppStatus.REJECTED),
    ]
    assert not inbox.unresolved(session, user.id)


def test_off_system_confirmation_lands_on_a_known_job(session, user):
    source = ingestion.manual_source(session, user.id)
    job = ingestion.ingest(
        session, source, NormalizedPosting("p", "Acme", "Backend Engineer", JD, location="Bengaluru")
    ).job
    matching.evaluate(session, user, job)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    assert app.status == AppStatus.SHORTLISTED

    # The user applied with LinkedIn Easy Apply instead of through job-copilot.
    body = "Your application was sent to Acme\nBackend Engineer\nAcme · Bengaluru, Karnataka, India\n"
    easy_apply = mail("Danush, your application was sent to Acme", body, sender="jobs-noreply@linkedin.com")
    worker.run_inbox_sync(session, user, FakeMail(easy_apply))
    session.refresh(app)
    assert app.status == AppStatus.SUBMISSION_CONFIRMED
    assert session.scalars(select(Job)).all().count(job) == 1


def test_vague_email_is_imported_by_hand(session, user):
    vague = mail("Thank you for applying", "We have received your application.", sender="no-reply@myworkday.com")
    worker.run_inbox_sync(session, user, FakeMail(vague))
    [record] = inbox.unresolved(session, user.id)

    app = inbox.import_message(session, user.id, record.id, "Initech", "Platform Engineer", "Pune")
    assert app.status == AppStatus.SUBMISSION_CONFIRMED and not inbox.unresolved(session, user.id)
    assert session.get(Job, app.job_id).title == "Platform Engineer"
