"""Classifier, matcher and Gmail parsing: pure functions, no database."""

import base64
import json
import uuid
from datetime import UTC, datetime

import httpx
import pytest

from jobcopilot.enums import MessageClass as C
from jobcopilot.inbox import gmail
from jobcopilot.inbox.classifier import classify
from jobcopilot.inbox.matcher import Candidate, match
from jobcopilot.inbox.message import EmailMessage, from_gmail


def email(subject: str, body: str = "", sender: str = "no-reply@greenhouse.io", name: str = "") -> EmailMessage:
    return EmailMessage(uuid.uuid4().hex, name, sender, subject, datetime.now(UTC), body)


@pytest.mark.parametrize(
    ("subject", "body", "expected"),
    [
        ("Thank you for applying to Acme", "We have received your application for Backend Engineer.", C.CONFIRMATION),
        ("Your application was sent to Acme", "", C.CONFIRMATION),
        (
            "Your application to Acme",
            "Thank you for applying. Unfortunately, we have decided to move forward with other candidates.",
            C.REJECTION,
        ),
        ("Update on your application", "We regret to inform you that the position has been filled.", C.REJECTION),
        ("Acme coding challenge", "Please complete the HackerRank assessment within 5 days.", C.ASSESSMENT),
        (
            "Interview invitation - Backend Engineer",
            "Please share your availability for a technical interview.",
            C.INTERVIEW,
        ),
        ("Offer letter", "We are pleased to extend an offer for the role of Backend Engineer.", C.OFFER),
        ("15 new jobs for Backend Engineer in Bengaluru", "Jobs you may be interested in", C.JOB_ALERT),
        ("Your electricity bill", "Amount due: 1200", C.OTHER),
    ],
)
def test_classify(subject, body, expected):
    assert classify(email(subject, body)).label == expected


def test_rejection_that_thanks_you_is_still_confident():
    result = classify(
        email("Your application", "Thank you for applying. Unfortunately, we will not be moving forward.")
    )
    assert result.label == C.REJECTION and result.confidence >= 0.9


def test_contradictory_email_has_low_confidence():
    result = classify(email("Next steps", "Unfortunately the role is closed, but we'd like to schedule an interview."))
    assert result.confidence < 0.8


ACME = Candidate(uuid.uuid4(), "Acme Technologies Pvt Ltd", "Backend Engineer")
GLOBEX = Candidate(uuid.uuid4(), "Globex", "Data Engineer")


def test_match_single_application_at_company():
    found = match(email("Thank you for applying to Acme", name="Acme Hiring"), [ACME, GLOBEX])
    assert found.application_id == ACME.application_id and found.confidence >= 0.9


def test_match_by_sender_domain():
    found = match(email("Thanks for applying", sender="careers@acme.com"), [ACME, GLOBEX])
    assert found.application_id == ACME.application_id


def test_two_applications_at_one_company_need_the_title():
    frontend = Candidate(uuid.uuid4(), "Acme", "Senior Frontend Engineer")
    clear = match(email("Your application for Senior Frontend Engineer at Acme"), [ACME, frontend])
    assert clear.application_id == frontend.application_id and clear.confidence >= 0.8
    unclear = match(email("Your application at Acme"), [ACME, frontend])
    assert unclear.confidence < 0.5


def test_no_match():
    assert match(email("Thanks for applying to Initech"), [ACME, GLOBEX]).application_id is None


def b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


GMAIL_PAYLOAD = {
    "id": "18c0ffee",
    "internalDate": "1760000000000",
    "snippet": "Thank you for applying",
    "payload": {
        "mimeType": "multipart/alternative",
        "headers": [
            {"name": "From", "value": "Acme Hiring <no-reply@greenhouse.io>"},
            {"name": "Subject", "value": "Thank you for applying to Acme"},
        ],
        "parts": [
            {"mimeType": "text/html", "body": {"data": b64("<p>Thank you for applying to <b>Acme</b></p>")}},
            {"mimeType": "text/plain", "body": {"data": b64("Thank you for applying to Acme.")}},
        ],
    },
}


def test_from_gmail_prefers_plain_text():
    message = from_gmail(GMAIL_PAYLOAD)
    assert message.from_name == "Acme Hiring" and message.sender_domain == "greenhouse.io"
    assert message.body == "Thank you for applying to Acme."
    assert message.received_at.year == 2025


def test_gmail_client_refreshes_token_and_pages(monkeypatch):
    stored = {"refresh_token": "r", "client_id": "c", "client_secret": "s", "token_uri": "https://oauth2.test/token"}
    monkeypatch.setattr(gmail.keyring, "get_password", lambda service, account: json.dumps(stored))
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "oauth2.test":
            return httpx.Response(200, json={"access_token": "a", "expires_in": 3600})
        assert request.headers["Authorization"] == "Bearer a"
        if request.url.path.endswith("/messages"):
            if "pageToken" in request.url.params:
                return httpx.Response(200, json={"messages": [{"id": "2"}]})
            assert "after:100" in request.url.params["q"]
            return httpx.Response(200, json={"messages": [{"id": "1"}], "nextPageToken": "p"})
        return httpx.Response(200, json=GMAIL_PAYLOAD)

    client = gmail.GmailClient("me@example.com", http=httpx.Client(transport=httpx.MockTransport(handler)))
    assert list(client.message_ids(100)) == ["1", "2"]
    assert client.get("1").subject == "Thank you for applying to Acme"
    assert sum(r.url.host == "oauth2.test" for r in seen) == 1  # token reused


def test_gmail_client_requires_authorization(monkeypatch):
    monkeypatch.setattr(gmail.keyring, "get_password", lambda service, account: None)
    with pytest.raises(gmail.GmailNotAuthorized):
        gmail.GmailClient("me@example.com")
