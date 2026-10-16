"""Background worker: scheduled and queued work, with the queue stored in PostgreSQL (Procrastinate).

Run it with `jobcopilot worker`. Tasks are thin wrappers that open a session and call a `run_*`
function; the `run_*` functions hold the logic and are what the tests exercise.
"""

import logging

from procrastinate import App, PsycopgConnector, RetryStrategy
from procrastinate.exceptions import AlreadyEnqueued  # noqa: F401 - re-exported for callers
from sqlalchemy import or_, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from jobcopilot.config import get_settings
from jobcopilot.db import get_sessionmaker
from jobcopilot.enums import AppStatus, Freshness
from jobcopilot.inbox import service as inbox
from jobcopilot.inbox.gmail import GmailClient, GmailNotAuthorized, MailSource
from jobcopilot.ingestion import service as ingestion
from jobcopilot.ingestion.adapters.base import BoardAdapter
from jobcopilot.ingestion.adapters.greenhouse import GreenhouseAdapter
from jobcopilot.ingestion.adapters.lever import LeverAdapter
from jobcopilot.ingestion.models import Job, Source
from jobcopilot.lifecycle.models import Application
from jobcopilot.llm.base import LLMProvider, get_provider
from jobcopilot.matching import service as matching
from jobcopilot.matching.extraction import LLM_EXTRACTOR_VERSION, ExtractionUnavailable
from jobcopilot.profile.models import User
from jobcopilot.profile.service import get_or_create_user

log = logging.getLogger("jobcopilot.worker")

BOARD_ADAPTERS: dict[str, type[BoardAdapter]] = {"greenhouse": GreenhouseAdapter, "lever": LeverAdapter}
# Statuses whose score can still change what happens next.
RESCORABLE = [AppStatus.DISCOVERED, AppStatus.REJECTED_BY_RULES, AppStatus.SHORTLISTED]


def _conninfo() -> str:
    # SQLAlchemy URL ("postgresql+psycopg://...") -> libpq URL for psycopg.
    url = make_url(get_settings().database_url).set(drivername="postgresql")
    return url.render_as_string(hide_password=False)


app = App(connector=PsycopgConnector(conninfo=_conninfo()))

network_retry = RetryStrategy(max_attempts=3, exponential_wait=10)


def _owner(session: Session) -> User:
    # Single-user MVP. Multi-user: iterate users with a configured source instead.
    return get_or_create_user(session, get_settings().owner_email)


# --- logic ---------------------------------------------------------------------------------------


def run_inbox_sync(session: Session, user: User, mail: MailSource) -> inbox.SyncReport:
    report = inbox.sync(session, user.id, mail)
    session.commit()
    return report


def run_board_polls(session: Session, user: User, adapters: dict[str, type[BoardAdapter]]) -> dict[str, int]:
    """Poll every board source. One failing board does not stop the others."""
    new_jobs: dict[str, int] = {}
    sources = session.scalars(select(Source).where(Source.user_id == user.id, Source.kind.in_(adapters))).all()
    for source in sources:
        label = f"{source.kind}:{source.config}"
        try:
            results = ingestion.poll_board(session, source, adapters[source.kind]())
        except Exception:  # noqa: BLE001 - poll_board recorded the failure on the source
            session.commit()
            log.exception("polling %s failed", label)
            continue
        for result in results:
            # A posting merged into a job first seen in an alert may bring the description it lacked.
            if result.new_posting:
                matching.evaluate(session, user, result.job)
        session.commit()
        new_jobs[label] = sum(r.new_job for r in results)
    return new_jobs


def run_rescore(session: Session, user: User) -> int:
    jobs = session.scalars(
        select(Job)
        .join(Application, Application.job_id == Job.id)
        .where(Application.user_id == user.id, Application.status.in_([str(s) for s in RESCORABLE]))
    ).all()
    for job in jobs:
        matching.evaluate(session, user, job)
    session.commit()
    return len(jobs)


# Only jobs whose score can still decide something are worth a model call.
REFINABLE = [AppStatus.DISCOVERED, AppStatus.SHORTLISTED]


def run_requirement_refinement(session: Session, user: User, provider: LLMProvider, limit: int = 25) -> int:
    """Re-extract requirements with a model for jobs that only have rule-extracted ones.

    Commits per job, so progress survives a crash. Stops (without marking anything) if the provider
    is unreachable; the next run picks up where this one left off.
    """
    jobs = session.scalars(
        select(Job)
        .join(Application, Application.job_id == Job.id)
        .where(
            Application.user_id == user.id,
            Application.status.in_([str(s) for s in REFINABLE]),
            Job.description != "",
            Job.freshness != Freshness.CLOSED,
            or_(Job.extractor_version.is_(None), Job.extractor_version.not_like(f"{LLM_EXTRACTOR_VERSION}%")),
        )
        .order_by(Job.last_seen_at.desc())
        .limit(limit)
    ).all()
    refined = 0
    for job in jobs:
        try:
            refined += matching.refine_requirements(session, provider, user, job)
        except ExtractionUnavailable as exc:
            session.rollback()
            log.warning("requirement extraction paused: %s", exc)
            break
        session.commit()
    return refined


# --- tasks ---------------------------------------------------------------------------------------


@app.periodic(cron="*/15 * * * *")
@app.task(queueing_lock="sync_inbox", retry=network_retry)
def sync_inbox(timestamp: int) -> None:
    with get_sessionmaker()() as session:
        user = _owner(session)
        try:
            mail = GmailClient(user.email)
        except GmailNotAuthorized as exc:
            log.info("skipping inbox sync: %s", exc)
            return
        report = run_inbox_sync(session, user, mail)
        log.info("inbox sync: fetched %d, %s", report.fetched, dict(report.actions))
    enqueue_refinement()


@app.periodic(cron="0 */6 * * *")
@app.task(queueing_lock="poll_boards", retry=network_retry)
def poll_boards(timestamp: int) -> None:
    with get_sessionmaker()() as session:
        log.info("board polls: new jobs %s", run_board_polls(session, _owner(session), BOARD_ADAPTERS))
    enqueue_refinement()


@app.periodic(cron="30 3 * * *")
@app.task(queueing_lock="mark_stale")
def mark_stale(timestamp: int) -> None:
    with get_sessionmaker()() as session:
        count = ingestion.mark_stale_jobs(session)
        session.commit()
        log.info("marked %d jobs stale", count)


@app.task(queueing_lock="rescore")
def rescore_open_jobs() -> None:
    with get_sessionmaker()() as session:
        log.info("re-scored %d jobs", run_rescore(session, _owner(session)))


def enqueue_rescore() -> None:
    """Called after facts or preferences change. Many changes in a row collapse into one queued job."""
    try:
        rescore_open_jobs.defer()
    except AlreadyEnqueued:
        pass


@app.periodic(cron="*/30 * * * *")
@app.task(queueing_lock="refine_requirements", retry=network_retry)
def refine_requirements(timestamp: int) -> None:
    settings = get_settings()
    if settings.requirement_extractor != "llm":
        return
    with get_sessionmaker()() as session:
        provider = get_provider(settings.extraction_provider)
        log.info("refined requirements of %d jobs", run_requirement_refinement(session, _owner(session), provider))


def enqueue_refinement() -> None:
    """Called after new jobs arrive, when model extraction is switched on."""
    if get_settings().requirement_extractor != "llm":
        return
    try:
        refine_requirements.defer(timestamp=0)
    except AlreadyEnqueued:
        pass
