"""Pure rules for application status transitions. No I/O; the service layer enforces these in a transaction.

Draft of design section 13. The guiding rule: nothing reaches a confirmed or outcome state without
an evidence row, except an outcome the user enters by hand (FR26), which records the user as actor.
"""

from dataclasses import dataclass

from jobcopilot.enums import Actor, AppStatus, EvidenceKind

S = AppStatus

OUTCOMES = frozenset({S.REJECTED, S.ASSESSMENT, S.INTERVIEW, S.OFFER})
TERMINAL = frozenset({S.REJECTED, S.OFFER, S.WITHDRAWN})
# The user applied outside job-copilot (Naukri NEO, LinkedIn Easy Apply, a careers page) and an email is
# the first we hear of it. Only reachable with evidence: see check_transition.
APPLIED_ELSEWHERE = frozenset({S.SUBMISSION_CONFIRMED}) | OUTCOMES
# Statuses in which the employer is known to have the application.
CONFIRMED = frozenset({S.SUBMISSION_CONFIRMED, S.ASSESSMENT, S.INTERVIEW})

# Statuses reachable from each status. Withdrawn and manual-intervention are added below for every
# non-terminal status, so they are not repeated here.
_TRANSITIONS: dict[AppStatus, frozenset[AppStatus]] = {
    S.DISCOVERED: frozenset({S.SHORTLISTED, S.REJECTED_BY_RULES}) | APPLIED_ELSEWHERE,
    # The user may override the filters.
    S.REJECTED_BY_RULES: frozenset({S.SHORTLISTED}) | APPLIED_ELSEWHERE,
    S.SHORTLISTED: frozenset({S.PREPARED, S.FAILED}) | APPLIED_ELSEWHERE,
    S.PREPARED: frozenset({S.AWAITING_APPROVAL, S.FAILED}) | APPLIED_ELSEWHERE,
    # Back to prepared when the user asks for regeneration.
    S.AWAITING_APPROVAL: frozenset({S.APPROVED, S.PREPARED}) | APPLIED_ELSEWHERE,
    # submitted_unconfirmed directly: the user applied via exported packet on an unsupported site.
    S.APPROVED: frozenset({S.SUBMISSION_IN_PROGRESS, S.SUBMITTED_UNCONFIRMED, S.AWAITING_APPROVAL}) | APPLIED_ELSEWHERE,
    # Back to approved if the user abandons the form.
    S.SUBMISSION_IN_PROGRESS: frozenset({S.SUBMITTED_UNCONFIRMED, S.SUBMISSION_CONFIRMED, S.APPROVED}),
    # An outcome email is itself proof the application arrived.
    S.SUBMITTED_UNCONFIRMED: frozenset({S.SUBMISSION_CONFIRMED} | OUTCOMES),
    S.SUBMISSION_CONFIRMED: OUTCOMES,
    S.ASSESSMENT: frozenset({S.INTERVIEW, S.REJECTED, S.OFFER}),
    S.INTERVIEW: frozenset({S.INTERVIEW, S.ASSESSMENT, S.REJECTED, S.OFFER}),
    S.FAILED: frozenset({S.SHORTLISTED}) | APPLIED_ELSEWHERE,
    # Resolving the manual queue may land anywhere the pipeline could have reached.
    S.NEEDS_MANUAL_INTERVENTION: frozenset(
        {
            S.SHORTLISTED,
            S.PREPARED,
            S.AWAITING_APPROVAL,
            S.APPROVED,
            S.SUBMITTED_UNCONFIRMED,
            S.SUBMISSION_CONFIRMED,
            S.FAILED,
        }
        | OUTCOMES
    ),
    S.REJECTED: frozenset(),
    S.OFFER: frozenset(),
    S.WITHDRAWN: frozenset(),
}

CONFIRMING_EVIDENCE = frozenset(
    {
        EvidenceKind.CONFIRMATION_PAGE,
        EvidenceKind.CONFIRMATION_EMAIL,
        EvidenceKind.REJECTION_EMAIL,
        EvidenceKind.ASSESSMENT_EMAIL,
        EvidenceKind.INTERVIEW_EMAIL,
        EvidenceKind.OFFER_EMAIL,
    }
)

# The status each kind of evidence moves an application towards.
EVIDENCE_TARGET: dict[EvidenceKind, AppStatus] = {
    EvidenceKind.CONFIRMATION_PAGE: S.SUBMISSION_CONFIRMED,
    EvidenceKind.CONFIRMATION_EMAIL: S.SUBMISSION_CONFIRMED,
    EvidenceKind.REJECTION_EMAIL: S.REJECTED,
    EvidenceKind.ASSESSMENT_EMAIL: S.ASSESSMENT,
    EvidenceKind.INTERVIEW_EMAIL: S.INTERVIEW,
    EvidenceKind.OFFER_EMAIL: S.OFFER,
    EvidenceKind.SUBMISSION_ATTEMPT: S.SUBMITTED_UNCONFIRMED,
}


def allowed_targets(current: AppStatus) -> frozenset[AppStatus]:
    targets = _TRANSITIONS[current]
    if current not in TERMINAL:
        targets = targets | {S.WITHDRAWN}
        if current != S.NEEDS_MANUAL_INTERVENTION:
            targets = targets | {S.NEEDS_MANUAL_INTERVENTION}
    return targets


@dataclass(frozen=True)
class TransitionCheck:
    ok: bool
    reason: str | None = None


def check_transition(
    current: AppStatus,
    target: AppStatus,
    actor: Actor,
    evidence_kind: EvidenceKind | None,
) -> TransitionCheck:
    """Structural guard: is this move legal, and is the evidence (if any) the right kind?

    Guards that need the database (documents validated before approval) live in the service.
    """
    if target not in allowed_targets(current):
        return TransitionCheck(False, f"{current} -> {target} is not an allowed transition")

    if target == S.SUBMISSION_CONFIRMED:
        if evidence_kind not in CONFIRMING_EVIDENCE:
            return TransitionCheck(False, "submission_confirmed requires confirmation evidence")

    if target in OUTCOMES:
        if evidence_kind is None:
            if actor != Actor.USER:
                return TransitionCheck(False, f"{actor} cannot record an outcome without evidence")
            if current not in CONFIRMED:
                return TransitionCheck(False, "an unconfirmed submission needs evidence to record an outcome")
        elif EVIDENCE_TARGET.get(evidence_kind) != target:
            return TransitionCheck(False, f"{evidence_kind} evidence does not support {target}")

    if target == S.SUBMITTED_UNCONFIRMED and actor not in {Actor.USER, Actor.EXTENSION}:
        return TransitionCheck(False, "only the user or the extension can record a submission")

    if target == S.APPROVED and actor != Actor.USER:
        return TransitionCheck(False, "only the user can approve an application")

    return TransitionCheck(True)
