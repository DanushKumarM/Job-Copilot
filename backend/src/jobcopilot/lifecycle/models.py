import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from jobcopilot.db import Base, Timestamped, UUIDPk, utcnow
from jobcopilot.enums import Actor, AppStatus, EvidenceKind, MessageClass, check_in


class Application(UUIDPk, Timestamped, Base):
    __tablename__ = "applications"
    __table_args__ = (
        UniqueConstraint("user_id", "job_id"),
        CheckConstraint(check_in("status", AppStatus), name="status"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default=AppStatus.DISCOVERED)
    lock_version: Mapped[int] = mapped_column(Integer, default=0)
    submitted_at: Mapped[datetime | None]
    confirmed_at: Mapped[datetime | None]
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class Evidence(UUIDPk, Timestamped, Base):
    __tablename__ = "evidence"
    __table_args__ = (CheckConstraint(check_in("kind", EvidenceKind), name="kind"),)

    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    # Gmail message ID, or a hash of a captured confirmation page. Unique => idempotent ingestion.
    external_ref: Mapped[str] = mapped_column(Text, unique=True)
    extracted: Mapped[dict] = mapped_column(JSONB, default=dict)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)


class ApplicationEvent(Base):
    """Append-only history. A database trigger rejects UPDATE and DELETE."""

    __tablename__ = "application_events"
    __table_args__ = (CheckConstraint(check_in("actor", Actor), name="actor"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(16))
    evidence_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("evidence.id"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class InboundMessage(UUIDPk, Base):
    """Metadata about a processed email. The body is never stored."""

    __tablename__ = "inbound_messages"
    __table_args__ = (CheckConstraint(check_in("classification", MessageClass), name="classification"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    gmail_message_id: Mapped[str] = mapped_column(String(128), unique=True)
    classification: Mapped[str] = mapped_column(String(16))
    confidence: Mapped[float] = mapped_column(Float)
    application_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("applications.id", ondelete="SET NULL"))
    # Subject, sender, date and how it was handled. Never the body.
    extracted: Mapped[dict] = mapped_column(JSONB, default=dict)
    processed_at: Mapped[datetime] = mapped_column(default=utcnow)
    # Set when the user assigns or dismisses a message from the inbox queue.
    resolved_at: Mapped[datetime | None]
