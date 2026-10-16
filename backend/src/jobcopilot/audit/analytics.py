"""Descriptive analytics only (design 2.4 F): counts, not recommendations."""

import uuid

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from jobcopilot.audit.models import LLMCall
from jobcopilot.enums import AppStatus
from jobcopilot.ingestion.models import JobPosting, Source
from jobcopilot.lifecycle.models import Application, ApplicationEvent

S = AppStatus

# A stage counts every application that ever reached any of its statuses (from the event log),
# so a later rejection does not erase the fact that an interview happened.
FUNNEL_STAGES: list[tuple[str, set[AppStatus]]] = [
    ("discovered", {S.DISCOVERED}),
    ("shortlisted", {S.SHORTLISTED}),
    ("approved", {S.APPROVED}),
    ("submitted", {S.SUBMITTED_UNCONFIRMED, S.SUBMISSION_CONFIRMED}),
    ("confirmed", {S.SUBMISSION_CONFIRMED, S.ASSESSMENT, S.INTERVIEW, S.OFFER, S.REJECTED}),
    ("assessment", {S.ASSESSMENT}),
    ("interview", {S.INTERVIEW}),
    ("offer", {S.OFFER}),
]


def _reached(session: Session, user_id: uuid.UUID, statuses: set[AppStatus], source_kind: str | None) -> int:
    query = (
        select(func.count(distinct(ApplicationEvent.application_id)))
        .join(Application, Application.id == ApplicationEvent.application_id)
        .where(Application.user_id == user_id, ApplicationEvent.to_status.in_([str(s) for s in statuses]))
    )
    if source_kind is not None:
        query = query.where(
            Application.job_id.in_(
                select(JobPosting.job_id)
                .join(Source, Source.id == JobPosting.source_id)
                .where(Source.kind == source_kind)
            )
        )
    return session.scalar(query)


def funnel(session: Session, user_id: uuid.UUID) -> dict:
    kinds = session.scalars(select(Source.kind).where(Source.user_id == user_id).distinct()).all()
    by_source = {
        kind: {stage: _reached(session, user_id, statuses, kind) for stage, statuses in FUNNEL_STAGES} for kind in kinds
    }
    current = dict(
        session.execute(
            select(Application.status, func.count()).where(Application.user_id == user_id).group_by(Application.status)
        ).all()
    )
    llm = session.execute(
        select(
            func.count(),
            func.coalesce(func.sum(LLMCall.cost_inr), 0.0),
            func.coalesce(func.sum(LLMCall.input_tokens + LLMCall.output_tokens), 0),
        ).where(LLMCall.user_id == user_id)
    ).one()
    return {
        "funnel": {stage: _reached(session, user_id, statuses, None) for stage, statuses in FUNNEL_STAGES},
        "by_source": by_source,
        "current_status": current,
        # Reported separately on purpose: some portals never send a confirmation (design 13).
        "submitted_unconfirmed_now": current.get(S.SUBMITTED_UNCONFIRMED, 0),
        "llm": {"calls": llm[0], "cost_inr": float(llm[1]), "tokens": int(llm[2])},
    }
