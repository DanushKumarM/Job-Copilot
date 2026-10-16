"""Ingestion and dedupe: many source postings, one canonical job (design 12.1)."""

import json
import re
import uuid
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from rapidfuzz import fuzz
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from jobcopilot.audit import service as audit
from jobcopilot.config import get_settings
from jobcopilot.db import utcnow
from jobcopilot.enums import Actor, Freshness, WorkMode
from jobcopilot.errors import DomainError, NotFound
from jobcopilot.ingestion.adapters.base import BoardAdapter, NormalizedPosting
from jobcopilot.ingestion.models import Company, Job, JobPosting, JobRequirement, Source
from jobcopilot.matching.scoring import RULE_EXTRACTOR_VERSION, RequirementDraft, extract_requirements
from jobcopilot.text import normalize_company, normalize_title, sha256_text

# Title similarity (0-100) at or above which two postings of one company are the same role.
MERGE_THRESHOLD = 92
# Between REVIEW and MERGE we still merge, but flag the merge for the user to confirm or split.
REVIEW_THRESHOLD = 85
STALE_AFTER = timedelta(days=30)

MANUAL_SOURCE_KIND = "manual"


@dataclass
class IngestResult:
    job: Job
    posting: JobPosting
    new_job: bool
    new_posting: bool

    @property
    def needs_review(self) -> bool:
        return self.posting.merge_confidence < MERGE_THRESHOLD / 100


def ensure_source(session: Session, user_id: uuid.UUID, kind: str, config: dict, access_basis: str) -> Source:
    for source in session.scalars(select(Source).where(Source.user_id == user_id, Source.kind == kind)):
        if source.config == config:
            return source
    source = Source(user_id=user_id, kind=kind, config=config, access_basis=access_basis)
    session.add(source)
    session.flush()
    return source


def manual_source(session: Session, user_id: uuid.UUID) -> Source:
    return ensure_source(session, user_id, MANUAL_SOURCE_KIND, {}, "pasted by the user")


def get_or_create_company(session: Session, name: str) -> Company:
    normalized = normalize_company(name)
    session.execute(
        insert(Company)
        .values(id=uuid.uuid4(), name=name.strip(), normalized_name=normalized, created_at=utcnow())
        .on_conflict_do_nothing(index_elements=["normalized_name"])
    )
    return session.scalars(select(Company).where(Company.normalized_name == normalized)).one()


def _location_compatible(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return True
    return fuzz.partial_ratio(a.lower(), b.lower()) >= 80


def find_canonical_job(session: Session, company: Company, posting: NormalizedPosting) -> tuple[Job | None, float]:
    title = normalize_title(posting.title)
    best: tuple[Job | None, float] = (None, 0.0)
    for job in session.scalars(select(Job).where(Job.company_id == company.id, Job.freshness != Freshness.CLOSED)):
        if not _location_compatible(job.location, posting.location):
            continue
        similarity = fuzz.token_sort_ratio(title, job.normalized_title)
        if similarity > best[1]:
            best = (job, similarity)
    job, similarity = best
    return (job, similarity) if similarity >= REVIEW_THRESHOLD else (None, 0.0)


def _write_snapshot(posting: NormalizedPosting, content_hash: str) -> str:
    root = Path(get_settings().file_root) / "snapshots"
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{content_hash}.json"
    if not path.exists():
        normalized = {k: v for k, v in posting.__dict__.items() if k != "raw"}
        snapshot = {"normalized": normalized, "raw": posting.raw}
        path.write_text(json.dumps(snapshot, default=str, ensure_ascii=False, indent=1), encoding="utf-8")
    return str(path)


def _store_requirements(session: Session, job: Job) -> None:
    replace_requirements(session, job, extract_requirements(job.description), RULE_EXTRACTOR_VERSION)


def replace_requirements(session: Session, job: Job, drafts: list[RequirementDraft], version: str) -> None:
    """Make `drafts` the job's requirements. Earlier rows are retired, not deleted: past evaluations
    still point at the requirements they scored."""
    session.execute(
        update(JobRequirement)
        .where(JobRequirement.job_id == job.id, JobRequirement.retired_at.is_(None))
        .values(retired_at=utcnow())
    )
    for draft in drafts:
        session.add(
            JobRequirement(
                job_id=job.id,
                statement=draft.statement,
                importance=draft.importance,
                terms=draft.terms,
                min_years=draft.min_years,
                extractor_version=version,
            )
        )
    job.extractor_version = version
    session.flush()


def ingest(session: Session, source: Source, posting: NormalizedPosting) -> IngestResult:
    content_hash = sha256_text(
        json.dumps([posting.title, posting.company, posting.location, posting.description], ensure_ascii=False)
    )
    now = utcnow()

    existing = session.scalars(
        select(JobPosting).where(JobPosting.source_id == source.id, JobPosting.external_id == posting.external_id)
    ).one_or_none()
    if existing is not None:
        job = session.get(Job, existing.job_id)
        existing.fetched_at = now
        if existing.content_hash != content_hash:
            existing.content_hash = content_hash
            existing.snapshot_path = _write_snapshot(posting, content_hash)
        job.last_seen_at = now
        job.freshness = Freshness.FRESH
        session.flush()
        return IngestResult(job, existing, new_job=False, new_posting=False)

    company = get_or_create_company(session, posting.company)
    job, similarity = find_canonical_job(session, company, posting)
    new_job = job is None
    if new_job:
        job = Job(
            company_id=company.id,
            title=posting.title,
            normalized_title=normalize_title(posting.title),
            location=posting.location,
            work_mode=posting.work_mode,
            salary_min=posting.salary_min,
            salary_max=posting.salary_max,
            description=posting.description,
            last_seen_at=now,
        )
        session.add(job)
        session.flush()
        _store_requirements(session, job)
    else:
        # Fill gaps from the new source without overwriting what we already know.
        job.location = job.location or posting.location
        if job.work_mode == WorkMode.UNKNOWN:
            job.work_mode = posting.work_mode
        job.salary_min = job.salary_min or posting.salary_min
        job.salary_max = job.salary_max or posting.salary_max
        if len(posting.description) > len(job.description):
            job.description = posting.description
            # A job first seen in an alert or an email had no description to extract requirements from.
            if not session.scalar(
                select(JobRequirement.id)
                .where(JobRequirement.job_id == job.id, JobRequirement.retired_at.is_(None))
                .limit(1)
            ):
                _store_requirements(session, job)
        job.last_seen_at = now
        job.freshness = Freshness.FRESH

    record = JobPosting(
        job_id=job.id,
        source_id=source.id,
        external_id=posting.external_id,
        url=posting.url,
        content_hash=content_hash,
        snapshot_path=_write_snapshot(posting, content_hash),
        merge_confidence=1.0 if new_job else similarity / 100,
        fetched_at=now,
    )
    session.add(record)
    session.flush()
    return IngestResult(job, record, new_job=new_job, new_posting=True)


def poll_board(session: Session, source: Source, adapter: BoardAdapter) -> list[IngestResult]:
    """Fetch a board, ingest every posting, and close jobs that vanished from it."""
    try:
        postings = adapter.fetch(source.config)
    except Exception as exc:  # noqa: BLE001 - record any fetch failure as source health
        source.health = "error"
        audit.record(
            session,
            user_id=source.user_id,
            actor=Actor.SYSTEM,
            action="source.poll_failed",
            entity_type="source",
            entity_id=source.id,
            details={"error": repr(exc)[:500]},
        )
        session.flush()
        raise
    results = [ingest(session, source, p) for p in postings]
    seen = {p.external_id for p in postings}
    gone = session.scalars(
        select(JobPosting).where(JobPosting.source_id == source.id, JobPosting.external_id.not_in(seen or {""}))
    ).all()
    for posting in gone:
        _close_if_no_live_postings(session, posting.job_id, source.id, seen)
    source.health = "ok"
    source.last_polled_at = utcnow()
    session.flush()
    return results


def _close_if_no_live_postings(session: Session, job_id: uuid.UUID, polled_source: uuid.UUID, seen: set[str]) -> None:
    others = session.scalars(select(JobPosting).where(JobPosting.job_id == job_id)).all()
    still_listed = any(p.source_id != polled_source or p.external_id in seen for p in others)
    if not still_listed:
        session.execute(update(Job).where(Job.id == job_id).values(freshness=Freshness.CLOSED))


def mark_stale_jobs(session: Session) -> int:
    result = session.execute(
        update(Job)
        .where(Job.freshness == Freshness.FRESH, Job.last_seen_at < utcnow() - STALE_AFTER)
        .values(freshness=Freshness.STALE)
    )
    return result.rowcount


def split_posting(session: Session, user_id: uuid.UUID, posting_id: uuid.UUID) -> Job:
    """Undo a false merge (FR8): move one posting onto a new job of its own."""
    posting = session.get(JobPosting, posting_id)
    if posting is None:
        raise NotFound(f"posting {posting_id}")
    old = session.get(Job, posting.job_id)
    if session.scalars(select(JobPosting).where(JobPosting.job_id == old.id)).all() == [posting]:
        raise DomainError("posting is already the only posting of its job")
    if not posting.snapshot_path:
        raise DomainError("posting has no snapshot to rebuild a job from")
    seen_as = json.loads(Path(posting.snapshot_path).read_text(encoding="utf-8"))["normalized"]
    new = Job(
        company_id=old.company_id,
        title=seen_as["title"],
        normalized_title=normalize_title(seen_as["title"]),
        location=seen_as["location"],
        work_mode=seen_as["work_mode"],
        salary_min=seen_as["salary_min"],
        salary_max=seen_as["salary_max"],
        description=seen_as["description"],
        last_seen_at=posting.fetched_at,
    )
    session.add(new)
    session.flush()
    posting.job_id = new.id
    posting.merge_confidence = 1.0
    _store_requirements(session, new)
    audit.record(
        session,
        user_id=user_id,
        actor=Actor.USER,
        action="job.split",
        entity_type="job_posting",
        entity_id=posting.id,
        details={"from_job": str(old.id), "to_job": str(new.id)},
    )
    session.flush()
    return new


# --- finding the posting behind an application page ---------------------------------------------

_GREENHOUSE_JOB = re.compile(r"/jobs/(\d+)")
_LEVER_JOB = re.compile(r"jobs\.lever\.co/[^/]+/([0-9a-f-]{36})", re.IGNORECASE)
_PAGE_SUFFIX = re.compile(r"/(apply|application|thanks|confirmation)$")


def adapter_for_url(url: str) -> str | None:
    """Which extension form adapter handles this page, if any."""
    host = urlsplit(url).netloc.lower()
    if host.endswith("greenhouse.io"):
        return "greenhouse"
    if host == "jobs.lever.co":
        return "lever"
    return None


def _normalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    host = parts.netloc.lower().removeprefix("www.")
    return host + _PAGE_SUFFIX.sub("", parts.path.rstrip("/")).rstrip("/")


def posting_for_url(session: Session, user_id: uuid.UUID, url: str) -> JobPosting | None:
    """The user's posting for a job or application page URL (the extension's "which job is this?").

    ATS job IDs are tried first (they survive the different URL shapes one job can have), then the URL.
    """
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    candidates: list[tuple[str, str]] = []
    if parts.netloc.lower().endswith("greenhouse.io"):
        match = _GREENHOUSE_JOB.search(parts.path)
        job_id = match.group(1) if match else (query.get("token") or [None])[0]
        if job_id:
            candidates.append(("greenhouse", job_id))
    if "gh_jid" in query:  # a careers page that embeds a Greenhouse form
        candidates.append(("greenhouse", query["gh_jid"][0]))
    if match := _LEVER_JOB.search(url):
        candidates.append(("lever", match.group(1).lower()))

    owned = select(JobPosting).join(Source, Source.id == JobPosting.source_id).where(Source.user_id == user_id)
    for kind, external_id in candidates:
        posting = session.scalars(owned.where(Source.kind == kind, JobPosting.external_id == external_id)).first()
        if posting is not None:
            return posting

    target = _normalize_url(url)
    host = target.split("/", 1)[0]
    for posting in session.scalars(owned.where(JobPosting.url.icontains(host))):
        if _normalize_url(posting.url) == target:
            return posting
    return None
