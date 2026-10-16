import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from jobcopilot.db import Base, Timestamped, UUIDPk
from jobcopilot.enums import FactKind, FactStatus, check_in


class User(UUIDPk, Timestamped, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    # Hard-filter settings (locations, work modes, min salary, excluded companies, ...).
    preferences: Mapped[dict] = mapped_column(JSONB, default=dict)
    password_hash: Mapped[str | None] = mapped_column(String(256))


class AuthSession(UUIDPk, Timestamped, Base):
    __tablename__ = "auth_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime]


class SourceDocument(UUIDPk, Timestamped, Base):
    __tablename__ = "source_documents"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    file_path: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))


class ProfileFact(UUIDPk, Timestamped, Base):
    """One atomic, user-verifiable statement about the candidate. Never edited in place."""

    __tablename__ = "profile_facts"
    __table_args__ = (
        CheckConstraint(check_in("status", FactStatus), name="status"),
        CheckConstraint(check_in("kind", FactKind), name="kind"),
        CheckConstraint("status <> 'superseded' OR superseded_by IS NOT NULL", name="superseded_has_successor"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("source_documents.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(32))
    statement: Mapped[str] = mapped_column(Text)
    # Structured hints, e.g. {"skills": ["Python"], "years": 4, "org": "Acme"}.
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default=FactStatus.PROPOSED)
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profile_facts.id"))
    verified_at: Mapped[datetime | None]


class AnswerBankEntry(UUIDPk, Timestamped, Base):
    __tablename__ = "answer_bank"
    __table_args__ = (UniqueConstraint("user_id", "question_key"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    question_key: Mapped[str] = mapped_column(String(128))  # e.g. "notice_period"
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    last_confirmed_at: Mapped[datetime]
