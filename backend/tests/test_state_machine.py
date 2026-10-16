import pytest

from jobcopilot.enums import Actor, AppStatus as S, EvidenceKind as E
from jobcopilot.lifecycle.state_machine import allowed_targets, check_transition


def test_happy_path_is_allowed():
    path = [
        (S.DISCOVERED, S.SHORTLISTED, Actor.SYSTEM, None),
        (S.SHORTLISTED, S.PREPARED, Actor.SYSTEM, None),
        (S.PREPARED, S.AWAITING_APPROVAL, Actor.SYSTEM, None),
        (S.AWAITING_APPROVAL, S.APPROVED, Actor.USER, None),
        (S.APPROVED, S.SUBMISSION_IN_PROGRESS, Actor.EXTENSION, None),
        (S.SUBMISSION_IN_PROGRESS, S.SUBMITTED_UNCONFIRMED, Actor.EXTENSION, E.SUBMISSION_ATTEMPT),
        (S.SUBMITTED_UNCONFIRMED, S.SUBMISSION_CONFIRMED, Actor.EMAIL, E.CONFIRMATION_EMAIL),
        (S.SUBMISSION_CONFIRMED, S.INTERVIEW, Actor.EMAIL, E.INTERVIEW_EMAIL),
        (S.INTERVIEW, S.OFFER, Actor.EMAIL, E.OFFER_EMAIL),
    ]
    for current, target, actor, evidence in path:
        assert check_transition(current, target, actor, evidence).ok, (current, target)


def test_confirmation_requires_evidence():
    result = check_transition(S.SUBMITTED_UNCONFIRMED, S.SUBMISSION_CONFIRMED, Actor.USER, None)
    assert not result.ok
    assert not check_transition(S.SUBMITTED_UNCONFIRMED, S.SUBMISSION_CONFIRMED, Actor.USER, E.MANUAL_NOTE).ok


def test_outcome_email_confirms_an_unconfirmed_submission():
    assert check_transition(S.SUBMITTED_UNCONFIRMED, S.REJECTED, Actor.EMAIL, E.REJECTION_EMAIL).ok


def test_evidence_must_match_the_outcome():
    assert not check_transition(S.SUBMISSION_CONFIRMED, S.OFFER, Actor.EMAIL, E.REJECTION_EMAIL).ok


def test_user_can_record_outcome_manually_only_after_confirmation():
    assert check_transition(S.SUBMISSION_CONFIRMED, S.INTERVIEW, Actor.USER, None).ok
    assert not check_transition(S.SUBMITTED_UNCONFIRMED, S.INTERVIEW, Actor.USER, None).ok
    assert not check_transition(S.SUBMISSION_CONFIRMED, S.INTERVIEW, Actor.SYSTEM, None).ok


def test_only_user_approves():
    assert not check_transition(S.AWAITING_APPROVAL, S.APPROVED, Actor.SYSTEM, None).ok


def test_system_cannot_claim_a_submission():
    assert not check_transition(S.APPROVED, S.SUBMITTED_UNCONFIRMED, Actor.SYSTEM, None).ok


@pytest.mark.parametrize("terminal", [S.REJECTED, S.OFFER, S.WITHDRAWN])
def test_terminal_states_have_no_exits(terminal):
    assert allowed_targets(terminal) == frozenset()


def test_cannot_skip_approval():
    assert not check_transition(S.PREPARED, S.SUBMISSION_IN_PROGRESS, Actor.EXTENSION, None).ok


def test_every_status_has_rules():
    for status in S:
        allowed_targets(status)


def test_applied_elsewhere_needs_evidence():
    # An application made outside job-copilot: the email is the evidence.
    assert check_transition(S.DISCOVERED, S.SUBMISSION_CONFIRMED, Actor.EMAIL, E.CONFIRMATION_EMAIL).ok
    assert check_transition(S.SHORTLISTED, S.REJECTED, Actor.EMAIL, E.REJECTION_EMAIL).ok
    assert not check_transition(S.DISCOVERED, S.SUBMISSION_CONFIRMED, Actor.USER, None).ok
    assert not check_transition(S.SHORTLISTED, S.INTERVIEW, Actor.USER, None).ok
