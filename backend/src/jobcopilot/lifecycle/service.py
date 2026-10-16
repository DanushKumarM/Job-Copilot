"""Application lifecycle: transitions with optimistic locking, an append-only event per change, and
idempotent evidence. Callers own the transaction (commit/rollback)."""

import uuid
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from jobcopilot.db import utcnow
from jobcopilot.enums import Actor, AppStatus, EvidenceKind
from jobcopilot.errors import ConcurrentModification, DomainError, InvalidTransition, NotFound
from jobcopilot.lifecycle.models import Application, ApplicationEvent, Evidence
from jobcopilot.lifecycle.state_machine import (
    CONFIRMING_EVIDENCE,
    EVIDENCE_TARGET,
    OUTCOMES,
    allowed_targets,
    check_transition,
)

# Evidence below this confidence never moves an application on its own; it goes to the manual queue.
AUTO_APPLY_CONFIDENCE = 0.8

# Where an application can already be for a piece of evidence to be redundant (e.g. a late
# confirmation email after an interview invite).
_AT_OR_PAST = {
    AppStatus.SUBMITTED_UNCONFIRMED: {AppStatus.SUBMITTED_UNCONFIRMED, AppStatus.SUBMISSION_CONFIRMED} | OUTCOMES,
    AppStatus.SUBMISSION_CONFIRMED: {AppStatus.SUBMISSION_CONFIRMED} | OUTCOMES,
}


def get_application(session: Session, user_id: uuid.UUID, application_id: uuid.UUID) -> Application:
    app = session.get(Application, application_id)
    if app is None or app.user_id != user_id:
        raise NotFound(f"application {application_id}")
    return app


def get_or_create_application(session: Session, user_id: uuid.UUID, job_id: uuid.UUID) -> tuple[Application, bool]:
    inserted = session.execute(
        insert(Application)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            job_id=job_id,
            status=AppStatus.DISCOVERED,
            lock_version=0,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        .on_conflict_do_nothing(index_elements=["user_id", "job_id"])
        .returning(Application.id)
    ).scalar_one_or_none()
    app = session.scalars(select(Application).where(Application.user_id == user_id, Application.job_id == job_id)).one()
    if inserted is not None:
        session.add(
            ApplicationEvent(
                application_id=app.id, from_status=None, to_status=AppStatus.DISCOVERED, actor=Actor.SYSTEM
            )
        )
        session.flush()
    return app, inserted is not None


def transition(
    session: Session,
    app: Application,
    target: AppStatus,
    actor: Actor,
    *,
    expected_lock_version: int | None = None,
    evidence: Evidence | None = None,
    note: str | None = None,
) -> Application:
    """Move an application to `target`, or raise. One UPDATE guarded by lock_version, plus one event."""
    current = AppStatus(app.status)
    version = app.lock_version if expected_lock_version is None else expected_lock_version
    if evidence is not None and evidence.application_id != app.id:
        raise DomainError("evidence belongs to a different application")

    check = check_transition(current, target, actor, EvidenceKind(evidence.kind) if evidence else None)
    if not check.ok:
        raise InvalidTransition(check.reason)
    return _write(session, app, current, target, actor, version, evidence, note)


def _write(
    session: Session,
    app: Application,
    current: AppStatus,
    target: AppStatus,
    actor: Actor,
    version: int,
    evidence: Evidence | None,
    note: str | None,
) -> Application:
    now = utcnow()
    values: dict = {"status": target, "lock_version": version + 1, "updated_at": now}
    first_confirmation = (
        evidence is not None
        and evidence.kind in CONFIRMING_EVIDENCE
        and target in OUTCOMES | {AppStatus.SUBMISSION_CONFIRMED}
        and app.confirmed_at is None
    )
    if target == AppStatus.SUBMITTED_UNCONFIRMED or first_confirmation:
        values["submitted_at"] = app.submitted_at or now
    if first_confirmation:
        values["confirmed_at"] = now

    result = session.execute(
        update(Application)
        .where(Application.id == app.id, Application.lock_version == version)
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise ConcurrentModification(f"application {app.id} changed since version {version}")

    session.add(
        ApplicationEvent(
            application_id=app.id,
            from_status=current,
            to_status=target,
            actor=actor,
            evidence_id=evidence.id if evidence else None,
            note=note,
        )
    )
    session.flush()
    session.refresh(app)
    return app


def record_evidence(
    session: Session,
    app: Application,
    kind: EvidenceKind,
    external_ref: str,
    extracted: dict | None = None,
    confidence: float = 1.0,
) -> tuple[Evidence, bool]:
    """Insert evidence once per external_ref. Returns (evidence, created)."""
    inserted = session.execute(
        insert(Evidence)
        .values(
            id=uuid.uuid4(),
            application_id=app.id,
            kind=kind,
            external_ref=external_ref,
            extracted=extracted or {},
            confidence=confidence,
            created_at=utcnow(),
        )
        .on_conflict_do_nothing(index_elements=["external_ref"])
        .returning(Evidence.id)
    ).scalar_one_or_none()
    evidence = session.scalars(select(Evidence).where(Evidence.external_ref == external_ref)).one()
    if evidence.application_id != app.id:
        raise DomainError(f"evidence {external_ref} is already linked to another application")
    return evidence, inserted is not None


@dataclass
class EvidenceOutcome:
    application: Application
    evidence: Evidence
    action: str  # "transitioned" | "attached" | "duplicate" | "needs_review"


def apply_evidence(
    session: Session,
    app: Application,
    kind: EvidenceKind,
    external_ref: str,
    actor: Actor,
    extracted: dict | None = None,
    confidence: float = 1.0,
) -> EvidenceOutcome:
    """Record evidence and move the application if the evidence justifies it.

    Idempotent: the same external_ref twice is a no-op. Evidence that does not fit the current
    status, or that is low-confidence, sends the application to the manual queue instead.
    """
    evidence, created = record_evidence(session, app, kind, external_ref, extracted, confidence)
    if not created:
        return EvidenceOutcome(app, evidence, "duplicate")
    return act_on_evidence(session, app, evidence, actor)


def act_on_evidence(session: Session, app: Application, evidence: Evidence, actor: Actor) -> EvidenceOutcome:
    """Move the application as far as an already-recorded piece of evidence justifies."""
    kind = EvidenceKind(evidence.kind)
    confidence = evidence.confidence
    target = EVIDENCE_TARGET.get(kind)
    current = AppStatus(app.status)

    if target is None or current in _AT_OR_PAST.get(target, set()):
        _attach(session, app, actor, evidence, "evidence attached; no status change")
        return EvidenceOutcome(app, evidence, "attached")

    if confidence < AUTO_APPLY_CONFIDENCE:
        reason = f"low-confidence {kind} ({confidence:.2f})"
        return EvidenceOutcome(_to_manual(session, app, actor, evidence, reason), evidence, "needs_review")

    if target in allowed_targets(current) and check_transition(current, target, actor, kind).ok:
        return EvidenceOutcome(transition(session, app, target, actor, evidence=evidence), evidence, "transitioned")

    reason = f"{kind} does not fit current status {current}"
    return EvidenceOutcome(_to_manual(session, app, actor, evidence, reason), evidence, "needs_review")


def _attach(session: Session, app: Application, actor: Actor, evidence: Evidence, note: str) -> None:
    """Log evidence against the application without changing its status."""
    session.add(
        ApplicationEvent(
            application_id=app.id,
            from_status=app.status,
            to_status=app.status,
            actor=actor,
            evidence_id=evidence.id,
            note=note,
        )
    )
    session.flush()


def _to_manual(session: Session, app: Application, actor: Actor, evidence: Evidence, reason: str) -> Application:
    if app.status == AppStatus.NEEDS_MANUAL_INTERVENTION or AppStatus.NEEDS_MANUAL_INTERVENTION not in allowed_targets(
        AppStatus(app.status)
    ):
        _attach(session, app, actor, evidence, reason)
        return app
    return transition(session, app, AppStatus.NEEDS_MANUAL_INTERVENTION, actor, evidence=evidence, note=reason)


def history(session: Session, application_id: uuid.UUID) -> list[ApplicationEvent]:
    return list(
        session.scalars(
            select(ApplicationEvent)
            .where(ApplicationEvent.application_id == application_id)
            .order_by(ApplicationEvent.id)
        )
    )


def release_from_manual(session: Session, app: Application, actor: Actor, note: str) -> Application:
    """Undo a parking in the manual queue: return to exactly the status the application came from.

    This bypasses the evidence guards on purpose. It asserts nothing new; it only reverses a move
    that turned out to be based on evidence about a different application.
    """
    if app.status != AppStatus.NEEDS_MANUAL_INTERVENTION:
        raise InvalidTransition(f"application is {app.status}, not waiting for manual intervention")
    parked = session.scalars(
        select(ApplicationEvent)
        .where(
            ApplicationEvent.application_id == app.id,
            ApplicationEvent.to_status == AppStatus.NEEDS_MANUAL_INTERVENTION,
            ApplicationEvent.from_status != AppStatus.NEEDS_MANUAL_INTERVENTION,
        )
        .order_by(ApplicationEvent.id.desc())
        .limit(1)
    ).one()
    previous = AppStatus(parked.from_status)
    return _write(session, app, AppStatus.NEEDS_MANUAL_INTERVENTION, previous, actor, app.lock_version, None, note)


def parked_by(session: Session, app: Application) -> uuid.UUID | None:
    """The evidence that sent a currently parked application to the manual queue, if any."""
    if app.status != AppStatus.NEEDS_MANUAL_INTERVENTION:
        return None
    return session.scalar(
        select(ApplicationEvent.evidence_id)
        .where(
            ApplicationEvent.application_id == app.id, ApplicationEvent.to_status == AppStatus.NEEDS_MANUAL_INTERVENTION
        )
        .order_by(ApplicationEvent.id.desc())
        .limit(1)
    )
