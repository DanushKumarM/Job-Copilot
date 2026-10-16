"""Applications made outside job-copilot (Naukri NEO, LinkedIn Easy Apply, a careers page), recognised
from their confirmation emails so they can be tracked alongside everything else (design 7, Naukri).

Only phrasings that name both the role and the company are accepted; anything vaguer stays in the inbox
queue for the user to import by hand. Like the alert formats, these phrasings should be checked against
real emails and extended as new ones turn up.
"""

import re
from dataclasses import dataclass

from jobcopilot.inbox.message import EmailMessage

_TITLE = r"(?:the )?(?P<title>[^\n]{2,100}?)(?: (?:position|role|job|opening))?"
_COMPANY = r"(?P<company>[^\n]{2,80}?)"
_END = r"(?=\s*(?:[.!,;\n]|$| (?:has|was|is|have)\b| on \w+ \d))"

_WITH_TITLE = [
    re.compile(p, re.IGNORECASE)
    for p in [
        # "Your application for Backend Engineer at Acme has been sent/submitted/received"
        rf"application (?:for|to) {_TITLE} (?:at|with) {_COMPANY} (?:has been|was|is) (?:successfully )?"
        r"(?:sent|submitted|received)",
        # "You have successfully applied for Backend Engineer at Acme"
        rf"(?:successfully )?applied (?:for|to) {_TITLE} (?:at|with) {_COMPANY}{_END}",
        # "Thank you for applying for the Backend Engineer role at Acme"
        rf"thanks? (?:you )?for (?:applying|your application) (?:for|to) {_TITLE} (?:at|with) {_COMPANY}{_END}",
        # "Application received: Backend Engineer at Acme" / "Applied: Backend Engineer - Acme"
        rf"^(?:application (?:received|submitted)|applied)\s*[:\-–]\s*{_TITLE} (?:at|-|–|\|) {_COMPANY}\s*$",
    ]
]
# LinkedIn: "Your application was sent to Acme", with the title on its own line below.
_SENT_TO = re.compile(r"your application was sent to (?P<company>[^\n]{2,80}?)\s*[.!]?\s*$", re.IGNORECASE | re.M)

_NOT_A_COMPANY = {"us", "our team", "the team", "the company", "our company", "you", "the hiring team"}

PLATFORM_BY_DOMAIN = {
    "naukri.com": "naukri",
    "linkedin.com": "linkedin",
    "greenhouse.io": "greenhouse",
    "lever.co": "lever",
    "ashbyhq.com": "ashby",
    "myworkday.com": "workday",
    "smartrecruiters.com": "smartrecruiters",
    "instahyre.com": "instahyre",
    "cutshort.io": "cutshort",
    "indeed.com": "indeed",
}


@dataclass(frozen=True)
class ExternalApplication:
    platform: str
    company: str
    title: str
    location: str | None = None


def platform_of(message: EmailMessage) -> str:
    domain = message.sender_domain
    for known, name in PLATFORM_BY_DOMAIN.items():
        if domain == known or domain.endswith("." + known):
            return name
    return "email"


def _clean(value: str) -> str:
    return value.strip().strip("\"'“”‘’").rstrip(".!,;:").strip()


def _plausible(title: str, company: str) -> bool:
    return (
        2 <= len(title) <= 100
        and 1 <= len(company) <= 80
        and company.lower() not in _NOT_A_COMPANY
        and title.lower() != company.lower()
    )


def extract(message: EmailMessage) -> ExternalApplication | None:
    """The role and company a confirmation email is about, or None when they are not both stated."""
    platform = platform_of(message)
    lines = [line.strip() for line in message.body.splitlines() if line.strip()]
    for text in [message.subject, *lines[:60]]:
        for pattern in _WITH_TITLE:
            if found := pattern.search(text):
                title, company = _clean(found["title"]), _clean(found["company"])
                if _plausible(title, company):
                    return ExternalApplication(platform, company, title)

    sent_to = _SENT_TO.search(message.subject) or _SENT_TO.search(message.body)
    if sent_to:
        company = _clean(sent_to["company"])
        # The card below the heading: title, then "Company · Location".
        try:
            start = next(i for i, line in enumerate(lines) if _SENT_TO.search(line))
        except StopIteration:
            start = -1
        following = lines[start + 1 : start + 4]
        for i, line in enumerate(following):
            if line.lower().startswith(company.lower()) and i > 0:
                title = _clean(following[i - 1])
                parts = re.split(r"\s+[·•|]\s+", line, maxsplit=1)
                location = parts[1].strip() if len(parts) > 1 else None
                if _plausible(title, company):
                    return ExternalApplication(platform, company, title, location)
    return None
