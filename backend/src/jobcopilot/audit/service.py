import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from jobcopilot.audit.models import AuditLog, LLMCall
from jobcopilot.enums import Actor


def record(
    session: Session,
    *,
    user_id: uuid.UUID | None,
    actor: Actor,
    action: str,
    entity_type: str,
    entity_id: object = None,
    details: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            user_id=user_id,
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=None if entity_id is None else str(entity_id),
            details=details or {},
        )
    )


def llm_spend_since(session: Session, since: datetime) -> float:
    return session.scalar(select(func.coalesce(func.sum(LLMCall.cost_inr), 0.0)).where(LLMCall.created_at >= since))
