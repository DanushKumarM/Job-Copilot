import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from jobcopilot.db import Base, Timestamped, UUIDPk, utcnow
from jobcopilot.enums import Freshness, Importance, WorkMode, check_in


class Source(UUIDPk, Timestamped, Base):
    __tablename__ = "sources"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))  # manual | greenhouse | lever | gmail_alert
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Why we are allowed to read this source, e.g. "public ATS API" or "user's own inbox".
    access_basis: Mapped[str] = mapped_column(Text)
    health: Mapped[str] = mapped_column(String(16), default="ok")
    last_polled_at: Mapped[datetime | None]


class Company(UUIDPk, Timestamped, Base):
    __tablename__ = "companies"

    name: Mapped[str] = mapped_column(Text)
    normalized_name: Mapped[str] = mapped_column(Text, unique=True)


class Job(UUIDPk, Timestamped, Base):
    """The canonical role. Several postings from different sources may point at one job."""

    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(check_in("work_mode", WorkMode), name="work_mode"),
        CheckConstraint(check_in("freshness", Freshness), name="freshness"),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    title: Mapped[str] = mapped_column(Text)
    normalized_title: Mapped[str] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    work_mode: Mapped[str] = mapped_column(String(16), default=WorkMode.UNKNOWN)
    salary_min: Mapped[int | None] = mapped_column(Integer)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    freshness: Mapped[str] = mapped_column(String(16), default=Freshness.FRESH)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    # What produced the current requirements, e.g. "rules-v1" or "llm-v1"; "llm-v1:failed" keeps the rules.
    extractor_version: Mapped[str | None] = mapped_column(String(32))


class JobPosting(UUIDPk, Base):
    __tablename__ = "job_postings"
    __table_args__ = (UniqueConstraint("source_id", "external_id"),)

    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id"), index=True)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"))
    external_id: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    snapshot_path: Mapped[str | None] = mapped_column(Text)
    merge_confidence: Mapped[float] = mapped_column(Float, default=1.0)
    fetched_at: Mapped[datetime] = mapped_column(default=utcnow)


class JobRequirement(UUIDPk, Base):
    __tablename__ = "job_requirements"
    __table_args__ = (CheckConstraint(check_in("importance", Importance), name="importance"),)

    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    statement: Mapped[str] = mapped_column(Text)
    importance: Mapped[str] = mapped_column(String(16))
    # Lower-cased terms the requirement is about ("python", "postgresql"); used for grounding checks.
    terms: Mapped[list] = mapped_column(JSONB, default=list)
    min_years: Mapped[float | None] = mapped_column(Float)
    extractor_version: Mapped[str] = mapped_column(String(32))
    # Set when a newer extraction replaces this row. Kept so older evaluations stay explainable.
    retired_at: Mapped[datetime | None]
