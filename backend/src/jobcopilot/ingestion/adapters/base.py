import html
import re
from dataclasses import dataclass, field
from typing import Protocol

from jobcopilot.enums import WorkMode


@dataclass
class NormalizedPosting:
    """What every source adapter produces. `raw` is kept as the snapshot."""

    external_id: str
    company: str
    title: str
    description: str
    url: str | None = None
    location: str | None = None
    work_mode: WorkMode = WorkMode.UNKNOWN
    salary_min: int | None = None
    salary_max: int | None = None
    raw: dict = field(default_factory=dict)


class BoardAdapter(Protocol):
    kind: str
    access_basis: str

    def fetch(self, config: dict) -> list[NormalizedPosting]: ...


_BLOCK = re.compile(r"</?(p|div|br|h[1-6]|ul|ol)\b[^>]*>", re.IGNORECASE)
_LI = re.compile(r"<li\b[^>]*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


def html_to_text(markup: str) -> str:
    """Good-enough HTML to text that keeps list items as "- " bullets for the requirement extractor."""
    text = html.unescape(markup)  # Greenhouse double-escapes its content field.
    text = _LI.sub("\n- ", text)
    text = _BLOCK.sub("\n", text)
    text = html.unescape(_TAG.sub("", text))
    lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def guess_work_mode(*texts: str | None) -> WorkMode:
    joined = " ".join(t for t in texts if t).lower()
    if "hybrid" in joined:
        return WorkMode.HYBRID
    if "remote" in joined:
        return WorkMode.REMOTE
    if "on-site" in joined or "onsite" in joined or "in office" in joined:
        return WorkMode.ONSITE
    return WorkMode.UNKNOWN
