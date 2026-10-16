"""Lever public Postings API (read-only, no key): GET /v0/postings/{site}?mode=json."""

import httpx

from jobcopilot.enums import WorkMode
from jobcopilot.ingestion.adapters.base import NormalizedPosting, guess_work_mode, html_to_text

API = "https://api.lever.co/v0/postings/{site}"

_WORKPLACE = {"remote": WorkMode.REMOTE, "hybrid": WorkMode.HYBRID, "onsite": WorkMode.ONSITE}


class LeverAdapter:
    kind = "lever"
    access_basis = "public ATS job-board API"

    def __init__(self, client: httpx.Client | None = None):
        self.client = client or httpx.Client(timeout=30)

    def fetch(self, config: dict) -> list[NormalizedPosting]:
        response = self.client.get(API.format(site=config["site"]), params={"mode": "json"})
        response.raise_for_status()
        return parse(response.json(), company=config.get("company") or config["site"])


def parse(payload: list[dict], company: str) -> list[NormalizedPosting]:
    postings = []
    for job in payload:
        categories = job.get("categories") or {}
        location = categories.get("location")
        sections = [job.get("descriptionPlain") or html_to_text(job.get("description") or "")]
        for block in job.get("lists") or []:
            sections.append(block.get("text", ""))
            sections.append(html_to_text(block.get("content", "")))
        sections.append(job.get("additionalPlain") or "")
        salary = job.get("salaryRange") or {}
        # Hard filters compare annual INR; anything else stays in the raw snapshot only.
        if salary.get("currency") != "INR" or salary.get("interval") != "per-year-salary":
            salary = {}
        postings.append(
            NormalizedPosting(
                external_id=job["id"],
                company=company,
                title=job["text"].strip(),
                description="\n".join(s for s in sections if s),
                url=job.get("hostedUrl"),
                location=location,
                work_mode=_WORKPLACE.get(job.get("workplaceType", ""), guess_work_mode(location)),
                salary_min=salary.get("min"),
                salary_max=salary.get("max"),
                raw=job,
            )
        )
    return postings
