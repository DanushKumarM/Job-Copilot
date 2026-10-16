import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from jobcopilot.db import Base, Timestamped, UUIDPk
from jobcopilot.enums import DocumentKind, DocumentState, check_in


class GeneratedDocument(UUIDPk, Timestamped, Base):
    """One version of one document kind for one application. Edits create a new version."""

    __tablename__ = "generated_documents"
    __table_args__ = (
        UniqueConstraint("application_id", "kind", "doc_version"),
        CheckConstraint(check_in("kind", DocumentKind), name="kind"),
        CheckConstraint(check_in("state", DocumentState), name="state"),
    )

    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    doc_version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(16), default=DocumentState.DRAFT)
    prompt_version: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(128))
    rendered_path: Mapped[str | None] = mapped_column(Text)

    claims: Mapped[list["Claim"]] = relationship(order_by="Claim.position", cascade="all, delete-orphan")


class Claim(UUIDPk, Base):
    __tablename__ = "claims"

    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("generated_documents.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer)

    evidence: Mapped[list["ClaimEvidence"]] = relationship(cascade="all, delete-orphan")

    @property
    def fact_ids(self) -> list[uuid.UUID]:
        return [e.fact_id for e in self.evidence]


class ClaimEvidence(Base):
    __tablename__ = "claim_evidence"

    claim_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), primary_key=True)
    # RESTRICT: a fact that backs a claim can be superseded but never deleted out from under it.
    fact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profile_facts.id", ondelete="RESTRICT"), primary_key=True)
