"""Job-alert emails → postings (FR6). Uses only what the email itself contains; job pages are never fetched.

Each alert lists jobs as cards: a link to the job (whose ID is in the URL) carrying the title, followed by
the company and location. The parser anchors on the job links, so layout changes around the cards do not
matter, and a card it cannot read completely is dropped rather than guessed. The formats were written from
the publicly known shape of LinkedIn and Naukri alerts and should be checked against real emails.
"""

import re
from dataclasses import dataclass
from html.parser import HTMLParser

from jobcopilot.inbox.message import EmailMessage
from jobcopilot.ingestion.adapters.base import NormalizedPosting, guess_work_mode


@dataclass(frozen=True)
class AlertPlatform:
    name: str
    sender_domains: tuple[str, ...]
    job_link: re.Pattern  # group 1: the platform's job ID
    canonical_url: str  # format string taking the matched link and the ID

    def owns(self, message: EmailMessage) -> bool:
        domain = message.sender_domain
        return any(domain == d or domain.endswith("." + d) for d in self.sender_domains)


PLATFORMS = [
    AlertPlatform(
        "linkedin",
        ("linkedin.com",),
        re.compile(r"linkedin\.com/(?:comm/)?jobs/view/(?:[\w%-]*?-)?(\d{6,})", re.IGNORECASE),
        "https://www.linkedin.com/jobs/view/{id}/",
    ),
    AlertPlatform(
        "naukri",
        ("naukri.com",),
        re.compile(r"naukri\.com/job-listings-[\w%-]*?-(\d{9,})", re.IGNORECASE),
        "https://www.naukri.com/{link}",
    ),
]

# Lines in a card that are not the company or the location.
_NOISE = re.compile(
    r"^(?:"
    r"\d+\s*(?:-|to)\s*\d+\s*yrs?|\d+\+?\s*(?:yrs?|years?)\b.*|"  # experience
    r"(?:₹|rs\.?|inr)\s*[\d.,].*|.*\b(?:lpa|lacs?|lakhs?)\b.*|not disclosed|"  # salary
    r"easy apply|apply(?: now)?|view(?: job)?|actively (?:recruiting|hiring)|promoted|new|"
    r"be an early applicant|.*\b\d+\s+(?:applicants?|connections?|alumni|school alumni)\b.*|"
    r".*\b(?:ago|today|yesterday)$|posted.*|see (?:all|more) jobs.*|"
    r"\d+(?:\.\d+)?\s*(?:★|stars?)?|\d+\s*reviews?"
    r")$",
    re.IGNORECASE,
)
_SEPARATOR = re.compile(r"\s+[·•|]\s+")
_MAX_FIELD = 120


@dataclass(frozen=True)
class AlertResult:
    platform: str
    postings: list[NormalizedPosting]


def platform_for(message: EmailMessage) -> AlertPlatform | None:
    return next((p for p in PLATFORMS if p.owns(message)), None)


def parse(message: EmailMessage) -> AlertResult | None:
    """Postings found in an alert email, or None if it is not from a known alert sender."""
    platform = platform_for(message)
    if platform is None:
        return None
    cards = _cards_from_html(message.html, platform) if message.html else []
    if not cards:
        cards = _cards_from_text(message.body, platform)
    postings = [p for card in cards if (p := _to_posting(card, platform, message)) is not None]
    return AlertResult(platform.name, postings)


@dataclass
class _Card:
    job_id: str
    link: str
    title: str
    details: list[str]


class _Chunks(HTMLParser):
    """Flattens HTML into text chunks, each with the href of the link it sits in (if any)."""

    _BREAKS = {"p", "div", "br", "tr", "td", "li", "table", "h1", "h2", "h3", "h4", "span"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.chunks: list[tuple[str, str | None]] = []
        self._href: list[str | None] = []
        self._text: list[str] = []

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self._text)).strip()
        if text:
            self.chunks.append((text, self._href[-1] if self._href else None))
        self._text = []

    def handle_starttag(self, tag, attrs):
        if tag in self._BREAKS or tag == "a":
            self._flush()
        if tag == "a":
            self._href.append(dict(attrs).get("href"))

    def handle_endtag(self, tag):
        if tag in self._BREAKS or tag == "a":
            self._flush()
        if tag == "a" and self._href:
            self._href.pop()

    def handle_data(self, data):
        self._text.append(data)

    def close(self):
        super().close()
        self._flush()


def _cards_from_html(markup: str, platform: AlertPlatform) -> list[_Card]:
    parser = _Chunks()
    parser.feed(markup)
    parser.close()
    cards: list[_Card] = []
    seen: set[str] = set()
    current: _Card | None = None
    for text, href in parser.chunks:
        found = platform.job_link.search(href or "")
        if found:
            job_id = found.group(1)
            if job_id not in seen:
                seen.add(job_id)
                current = _Card(job_id, found.group(0), text, [])
                cards.append(current)
            elif current is not None and job_id == current.job_id:
                current.details.append(text)  # a second link in the same card, e.g. on the company name
            else:
                current = None
        elif current is not None:
            current.details.append(text)
    return cards


def _cards_from_text(body: str, platform: AlertPlatform) -> list[_Card]:
    """Plain-text alerts: the job's lines come right before its link (e.g. "View job: https://...")."""
    cards: list[_Card] = []
    seen: set[str] = set()
    pending: list[str] = []
    for raw in body.splitlines():
        line = raw.strip()
        found = platform.job_link.search(line)
        if found:
            if found.group(1) not in seen and pending:
                seen.add(found.group(1))
                cards.append(_Card(found.group(1), found.group(0), pending[0], pending[1:]))
            pending = []
        elif line and set(line) <= set("-=_*"):
            pending = []  # a separator between cards
        elif line and not _NOISE.match(line):
            pending = (pending + [line])[-3:]
    return cards


def _to_posting(card: _Card, platform: AlertPlatform, message: EmailMessage) -> NormalizedPosting | None:
    title = card.title.strip()
    details = [d for d in card.details if not _NOISE.match(d) and d.strip().lower() != title.lower()]
    if not details:
        return None
    first = _SEPARATOR.split(details[0], maxsplit=1)
    company = first[0].strip()
    location = first[1].strip() if len(first) > 1 else (details[1].strip() if len(details) > 1 else None)
    if not (2 <= len(title) <= _MAX_FIELD and 1 <= len(company) <= _MAX_FIELD):
        return None
    if location and len(location) > _MAX_FIELD:
        location = None
    return NormalizedPosting(
        external_id=f"{platform.name}:{card.job_id}",
        company=company,
        title=title,
        description="",  # alerts carry no description; a board posting of the same job fills it in
        url=platform.canonical_url.format(id=card.job_id, link=card.link.split("naukri.com/", 1)[-1]),
        location=location,
        work_mode=guess_work_mode(location, title),
        # Tracking parameters and the email itself are not kept.
        raw={"alert_email": message.id, "platform": platform.name},
    )
