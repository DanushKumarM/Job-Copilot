import base64
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parseaddr

from jobcopilot.ingestion.adapters.base import html_to_text


@dataclass(frozen=True)
class EmailMessage:
    """An email held in memory only while it is classified. The body is never persisted."""

    id: str
    from_name: str
    from_address: str
    subject: str
    received_at: datetime
    body: str
    # Kept alongside the text body because job-alert cards are only reliably structured in HTML.
    html: str = ""

    @property
    def sender_domain(self) -> str:
        return self.from_address.rpartition("@")[2].lower()


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _bodies(part: dict, found: dict[str, str]) -> None:
    mime = part.get("mimeType", "")
    data = (part.get("body") or {}).get("data")
    if data and mime in {"text/plain", "text/html"} and mime not in found:
        found[mime] = _decode(data)
    for child in part.get("parts") or []:
        _bodies(child, found)


def from_gmail(payload: dict) -> EmailMessage:
    """Parse a Gmail API `users.messages.get?format=full` response."""
    headers = {h["name"].lower(): h["value"] for h in payload["payload"].get("headers", [])}
    name, address = parseaddr(headers.get("from", ""))
    found: dict[str, str] = {}
    _bodies(payload["payload"], found)
    body = found.get("text/plain") or html_to_text(found.get("text/html", "")) or payload.get("snippet", "")
    return EmailMessage(
        id=payload["id"],
        from_name=name,
        from_address=address,
        subject=headers.get("subject", ""),
        received_at=datetime.fromtimestamp(int(payload["internalDate"]) / 1000, UTC),
        body=body,
        html=found.get("text/html", ""),
    )
