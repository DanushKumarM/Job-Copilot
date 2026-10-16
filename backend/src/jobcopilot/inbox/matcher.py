"""Which application does an email belong to? Company name first, job title to break ties (FR25)."""

import re
import uuid
from dataclasses import dataclass

from rapidfuzz import fuzz

from jobcopilot.inbox.message import EmailMessage
from jobcopilot.text import normalize_company, normalize_title


@dataclass(frozen=True)
class Candidate:
    application_id: uuid.UUID
    company: str
    job_title: str


@dataclass(frozen=True)
class Match:
    application_id: uuid.UUID | None
    confidence: float
    reason: str


def _mentions_company(message: EmailMessage, company: str) -> bool:
    name = normalize_company(company)
    if not name:
        return False
    pattern = re.compile(r"\b" + re.escape(name) + r"\b", re.IGNORECASE)
    haystack = f"{message.from_name}\n{message.subject}\n{message.body[:5000]}"
    compact = name.replace(" ", "")
    return bool(pattern.search(haystack)) or compact in message.sender_domain.replace("-", "")


def _title_score(message: EmailMessage, title: str) -> float:
    text = normalize_title(f"{message.subject} {message.body[:3000]}")
    return fuzz.partial_ratio(normalize_title(title), text) / 100


def match(message: EmailMessage, candidates: list[Candidate]) -> Match:
    by_company = [c for c in candidates if _mentions_company(message, c.company)]
    if not by_company:
        return Match(None, 0.0, "no open application's company is mentioned")
    if len(by_company) == 1:
        [only] = by_company
        title = _title_score(message, only.job_title)
        confidence = 1.0 if title >= 0.9 else 0.9
        return Match(only.application_id, confidence, f"only open application at {only.company}")

    # Several applications at one company: only the title can tell them apart.
    scored = sorted(((_title_score(message, c.job_title), c) for c in by_company), key=lambda p: p[0], reverse=True)
    (best_score, best), (runner_up, _) = scored[0], scored[1]
    if best_score >= 0.9 and best_score - runner_up >= 0.1:
        return Match(best.application_id, 0.85, f"title '{best.job_title}' at {best.company}")
    return Match(best.application_id, 0.4, f"{len(by_company)} open applications at {best.company}; title unclear")
