import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from jobcopilot.db import Base, Timestamped, UUIDPk
from jobcopilot.enums import Coverage, check_in


class MatchEvaluation(UUIDPk, Timestamped, Base):
    __tablename__ = "match_evaluations"

    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    scorer_version: Mapped[str] = mapped_column(String(32))
    score: Mapped[int] = mapped_column(Integer)
    breakdown: Mapped[dict] = mapped_column(JSONB)
    hard_filter_pass: Mapped[bool] = mapped_column(Boolean)
    hard_filter_reasons: Mapped[list] = mapped_column(JSONB, default=list)


class RequirementMatch(UUIDPk, Base):
    """One row per (requirement, supporting fact); a gap is a row with no fact."""

    __tablename__ = "requirement_matches"
    __table_args__ = (
        CheckConstraint(check_in("coverage", Coverage), name="coverage"),
        CheckConstraint("(coverage = 'gap') = (fact_id IS NULL)", name="gap_has_no_fact"),
    )

    evaluation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("match_evaluations.id", ondelete="CASCADE"), index=True)
    requirement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("job_requirements.id", ondelete="CASCADE"))
    fact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profile_facts.id", ondelete="CASCADE"))
    coverage: Mapped[str] = mapped_column(String(16))
    rationale: Mapped[str | None] = mapped_column(Text)
