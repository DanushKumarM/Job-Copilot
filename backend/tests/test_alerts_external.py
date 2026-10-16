"""Job-alert parsing and off-system application extraction: pure functions, no database.

The emails here are synthetic, modelled on the general shape of LinkedIn and Naukri mail.
"""

import uuid
from datetime import UTC, datetime

import pytest

from jobcopilot.enums import WorkMode
from jobcopilot.inbox import alerts, external
from jobcopilot.inbox.message import EmailMessage


def email(subject: str, body: str = "", sender: str = "jobalerts-noreply@linkedin.com", html: str = "") -> EmailMessage:
    return EmailMessage(uuid.uuid4().hex, "", sender, subject, datetime.now(UTC), body, html)


LINKEDIN_HTML = """
<table><tr><td>
  <p>Your job alert for <b>backend engineer</b> in Bengaluru</p>
  <table>
    <tr><td><a href="https://www.linkedin.com/comm/jobs/view/3901234567/?trackingId=abc&amp;refId=xyz">
      <img src="logo.png" alt=""></a></td>
      <td><a href="https://www.linkedin.com/comm/jobs/view/3901234567/?trackingId=abc">Backend Engineer</a>
        <p>Acme Technologies &middot; Bengaluru, Karnataka, India (Hybrid)</p>
        <p>Actively recruiting</p><p>Easy Apply</p></td></tr>
    <tr><td><a href="https://www.linkedin.com/comm/jobs/view/3907654321/?trackingId=def">Senior Python Developer</a>
        <p>Globex</p><p>Remote</p><p>3 days ago</p></td></tr>
  </table>
  <a href="https://www.linkedin.com/comm/jobs/search?keywords=backend">See all jobs</a>
  <p>You are receiving Job Alert emails.</p><a href="https://www.linkedin.com/comm/unsubscribe">Unsubscribe</a>
</td></tr></table>
"""

LINKEDIN_TEXT = """Your job alert for backend engineer

Backend Engineer
Acme Technologies
Bengaluru, Karnataka, India
View job: https://www.linkedin.com/comm/jobs/view/3901234567/?trackingId=abc

---------------------------------------------------------

Data Engineer
Initech
Pune, Maharashtra, India
View job: https://www.linkedin.com/comm/jobs/view/3909999999/?trackingId=ghi

See all jobs: https://www.linkedin.com/comm/jobs/search
"""

NAUKRI_HTML = """
<div><a href="https://www.naukri.com/job-listings-backend-developer-hooli-bengaluru-3-to-6-years-101025012345?src=jobalert">
  Backend Developer</a>
  <div>Hooli Pvt Ltd</div><div>3-6 Yrs</div><div>Not disclosed</div><div>Bengaluru</div></div>
<div><a href="https://www.naukri.com/job-listings-sde-2-vandelay-hyderabad-4-to-8-years-101025067890?src=jobalert">
  SDE 2</a>
  <div>Vandelay Industries</div><div>4.1</div><div>4-8 Yrs</div><div>Hyderabad, Bengaluru</div></div>
"""


def test_linkedin_html_alert():
    result = alerts.parse(
        email("“backend engineer”: Acme Technologies - Backend Engineer and more", html=LINKEDIN_HTML)
    )
    assert result.platform == "linkedin"
    first, second = result.postings
    assert (first.title, first.company) == ("Backend Engineer", "Acme Technologies")
    assert first.location == "Bengaluru, Karnataka, India (Hybrid)" and first.work_mode == WorkMode.HYBRID
    assert first.external_id == "linkedin:3901234567"
    assert first.url == "https://www.linkedin.com/jobs/view/3901234567/"  # tracking parameters dropped
    assert (second.title, second.company, second.location) == ("Senior Python Developer", "Globex", "Remote")
    assert "trackingId" not in str(first.raw)


def test_linkedin_plain_text_alert():
    result = alerts.parse(email("New jobs for backend engineer", body=LINKEDIN_TEXT))
    assert [(p.title, p.company, p.location) for p in result.postings] == [
        ("Backend Engineer", "Acme Technologies", "Bengaluru, Karnataka, India"),
        ("Data Engineer", "Initech", "Pune, Maharashtra, India"),
    ]


def test_naukri_alert_skips_experience_salary_and_rating():
    result = alerts.parse(email("Jobs matching your profile", sender="jobalert@naukri.com", html=NAUKRI_HTML))
    assert result.platform == "naukri"
    assert [(p.title, p.company, p.location) for p in result.postings] == [
        ("Backend Developer", "Hooli Pvt Ltd", "Bengaluru"),
        ("SDE 2", "Vandelay Industries", "Hyderabad, Bengaluru"),
    ]
    assert result.postings[0].external_id == "naukri:101025012345"
    assert result.postings[0].url.startswith("https://www.naukri.com/job-listings-backend-developer")
    assert "?" not in result.postings[0].url


def test_unknown_sender_is_not_an_alert():
    assert alerts.parse(email("Jobs for you", sender="news@example.com", html=LINKEDIN_HTML)) is None


def test_card_without_company_is_dropped_not_guessed():
    markup = '<a href="https://www.linkedin.com/comm/jobs/view/3901234567/">Backend Engineer</a><p>Easy Apply</p>'
    assert alerts.parse(email("alert", html=markup)).postings == []


@pytest.mark.parametrize(
    ("subject", "body", "sender", "expected"),
    [
        (
            "Your application for Backend Developer at Hooli has been sent",
            "",
            "info@naukri.com",
            ("naukri", "Hooli", "Backend Developer"),
        ),
        (
            "Applied successfully",
            "You have successfully applied for SDE 2 at Vandelay Industries.\nRecommended jobs for you ...",
            "jobs@naukri.com",
            ("naukri", "Vandelay Industries", "SDE 2"),
        ),
        (
            "Thank you for applying!",
            "Hi,\nThank you for applying for the Platform Engineer role at Initech. We will review it shortly.",
            "no-reply@ashbyhq.com",
            ("ashby", "Initech", "Platform Engineer"),
        ),
        (
            "Application received: Data Engineer at Globex",
            "",
            "careers@globex.com",
            ("email", "Globex", "Data Engineer"),
        ),
    ],
)
def test_extract_external_application(subject, body, sender, expected):
    found = external.extract(email(subject, body, sender=sender))
    assert (found.platform, found.company, found.title) == expected


def test_extract_linkedin_easy_apply():
    body = (
        "Your application was sent to Acme Technologies\n"
        "Backend Engineer\n"
        "Acme Technologies · Bengaluru, Karnataka, India (Hybrid)\n"
        "Applied on October 10, 2026\n"
    )
    found = external.extract(
        email("Danush, your application was sent to Acme Technologies", body, sender="jobs-noreply@linkedin.com")
    )
    assert found == external.ExternalApplication(
        "linkedin", "Acme Technologies", "Backend Engineer", "Bengaluru, Karnataka, India (Hybrid)"
    )


@pytest.mark.parametrize(
    ("subject", "body"),
    [
        ("Thank you for applying", "We have received your application and will be in touch."),
        ("Thanks for applying to us", "Your application for the role at our company has been received."),
        ("Your application was sent to Acme", "Thanks!"),  # no title anywhere
    ],
)
def test_vague_confirmations_are_not_imported(subject, body):
    assert external.extract(email(subject, body, sender="no-reply@myworkday.com")) is None
