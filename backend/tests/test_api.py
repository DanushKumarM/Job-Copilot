import json

import pytest
from fastapi.testclient import TestClient
from test_integration import RESUME, ScriptedLLM

from jobcopilot.api.deps import llm_provider
from jobcopilot.config import get_settings
from jobcopilot.db import get_session
from jobcopilot.main import app

JD = """We build payments infrastructure.
Requirements
- 3+ years of professional software development experience
- Strong Python
- Experience with PostgreSQL and REST APIs
Nice to have
- Kafka
"""


@pytest.fixture
def client(session, monkeypatch):
    monkeypatch.setenv("JOBCOPILOT_API_TOKEN", "test-token")
    monkeypatch.setenv("JOBCOPILOT_OWNER_EMAIL", "owner@example.com")
    get_settings.cache_clear()
    llm = ScriptedLLM([])
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[llm_provider] = lambda: llm
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as c:
        c.llm = llm
        yield c
    app.dependency_overrides.clear()


def test_requires_token(client):
    assert client.get("/api/profile/facts", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_full_flow_over_http(client):
    facts = client.post("/api/profile/resume", json={"text": RESUME}).json()
    for fact in facts:
        assert client.post(f"/api/profile/facts/{fact['id']}/verify").status_code == 200
    client.put("/api/profile/preferences", json={"locations": ["Bengaluru"]})
    client.put("/api/profile/answers/notice_period", json={"question": "Notice period?", "answer": "30 days"})

    job = client.post(
        "/api/jobs",
        json={
            "title": "Backend Engineer",
            "company": "Acme",
            "location": "Bengaluru",
            "description": JD,
            "url": "https://example.com/jobs/1",
        },
    ).json()
    assert job["score"] == 70 and job["application_status"] == "shortlisted"
    app_id = job["application_id"]

    billing = next(f["id"] for f in facts if "billing" in f["statement"])
    client.llm.outputs.append(
        json.dumps(
            {
                "claims": [
                    {"body": "Built Python billing services handling 2 million invoices a month", "fact_ids": [billing]}
                ]
            }
        )
    )
    doc = client.post(f"/api/applications/{app_id}/generate", json={"kind": "resume_bullets"}).json()
    assert doc["doc_version"] == 1 and doc["claims"][0]["fact_ids"] == [billing]

    # A user edit that invents a claim is refused with the validator's reasons.
    bad = client.put(
        f"/api/applications/{app_id}/documents/resume_bullets",
        json={"claims": [{"body": "Led a team of 12 engineers", "fact_ids": [billing]}]},
    )
    assert bad.status_code == 422 and "12" in bad.json()["issues"][0]

    detail = client.get(f"/api/applications/{app_id}").json()
    assert client.get(f"/api/applications/{app_id}/packet").status_code == 409  # not approved yet
    stale = client.post(f"/api/applications/{app_id}/approve", json={"lock_version": detail["lock_version"] - 1})
    assert stale.status_code == 409
    approved = client.post(f"/api/applications/{app_id}/approve", json={"lock_version": detail["lock_version"]})
    assert approved.json()["status"] == "approved"

    detail = client.get(f"/api/applications/{app_id}").json()
    assert detail["job_title"] == "Backend Engineer" and detail["company"] == "Acme"
    assert "submission_in_progress" in detail["allowed_targets"]
    pdf = client.get(f"/api/applications/{app_id}/resume.pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF") and "resume-acme-backend-engineer.pdf" in pdf.headers["content-disposition"]

    packet = client.get(f"/api/applications/{app_id}/packet").json()
    assert packet["answers"] == {"notice_period": "30 days"} and packet["documents"]["resume_bullets"]

    result = client.post(
        f"/api/applications/{app_id}/evidence", json={"kind": "submission_attempt", "external_ref": "attempt:1"}
    ).json()
    assert result["application"]["status"] == "submitted_unconfirmed"
    result = client.post(
        f"/api/applications/{app_id}/evidence", json={"kind": "confirmation_page", "external_ref": "page:abc"}
    ).json()
    assert result["application"]["status"] == "submission_confirmed"

    funnel = client.get("/api/analytics/funnel").json()
    assert funnel["funnel"]["confirmed"] == 1 and funnel["llm"]["calls"] == 1


def test_import_an_off_system_application_from_the_inbox(client, session):
    from test_worker import FakeMail, mail

    from jobcopilot import worker
    from jobcopilot.profile.service import get_or_create_user

    user = get_or_create_user(session, "owner@example.com")
    vague = mail("Thank you for applying", "We have received your application.", sender="no-reply@myworkday.com")
    worker.run_inbox_sync(session, user, FakeMail(vague))
    [message] = client.get("/api/inbox").json()

    body = {"company": "Initech", "title": "Platform Engineer", "location": "Pune"}
    app = client.post(f"/api/inbox/{message['id']}/import", json=body).json()
    assert app["status"] == "submission_confirmed"
    assert client.get("/api/inbox").json() == []


def test_extension_finds_the_application_behind_a_page(client, session):
    from test_integration import FakeAdapter, gh_postings, lever_postings

    from jobcopilot.ingestion import service as ingestion
    from jobcopilot.profile.service import get_or_create_user

    user = get_or_create_user(session, "owner@example.com")
    for kind, config, postings in (
        ("greenhouse", {"board_token": "acme"}, gh_postings()),
        ("lever", {"site": "acme"}, lever_postings()),
    ):
        source = ingestion.ensure_source(session, user.id, kind, config, "public ATS job-board API")
        ingestion.poll_board(session, source, FakeAdapter(postings))

    def lookup(url):
        return client.get("/api/extension/lookup", params={"url": url})

    # The same Greenhouse job under its different URL shapes.
    for url in (
        "https://boards.greenhouse.io/acme/jobs/4012345#app",
        "https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=abc",
        "https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345",
    ):
        found = lookup(url).json()
        assert found["application"]["job_title"] == "Backend Engineer", url
        assert found["adapter"] == "greenhouse" and found["packet_ready"] is False
    assert lookup("https://www.acme.com/careers/backend?gh_jid=4012345").json()["adapter"] is None

    lever = lookup("https://jobs.lever.co/acme/8f1c2b7e-0000-4a5b-9c1d-acme00000001/apply").json()
    assert lever["adapter"] == "lever" and lever["application"]["job_title"] == "Backend Engineer"

    assert lookup("https://boards.greenhouse.io/acme/jobs/999").status_code == 404


def test_status_reports_configuration(client):
    status = client.get("/api/status").json()
    assert status["requirement_extractor"] == "rules" and status["contact_fields"]["full_name"] == "Full name"
