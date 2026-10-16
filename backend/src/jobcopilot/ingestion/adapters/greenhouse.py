"""Greenhouse public Job Board API (read-only, no key): GET /v1/boards/{board_token}/jobs?content=true."""

import httpx

from jobcopilot.ingestion.adapters.base import NormalizedPosting, guess_work_mode, html_to_text

API = "https://boards-api.greenhouse.io/v1/boards/{board}/jobs"


class GreenhouseAdapter:
    kind = "greenhouse"
    access_basis = "public ATS job-board API"

    def __init__(self, client: httpx.Client | None = None):
        self.client = client or httpx.Client(timeout=30)

    def fetch(self, config: dict) -> list[NormalizedPosting]:
        response = self.client.get(API.format(board=config["board_token"]), params={"content": "true"})
        response.raise_for_status()
        return parse(response.json(), company=config.get("company") or config["board_token"])


def parse(payload: dict, company: str) -> list[NormalizedPosting]:
    postings = []
    for job in payload.get("jobs", []):
        location = (job.get("location") or {}).get("name")
        description = html_to_text(job.get("content") or "")
        postings.append(
            NormalizedPosting(
                external_id=str(job["id"]),
                company=job.get("company_name") or company,
                title=job["title"].strip(),
                description=description,
                url=job.get("absolute_url"),
                location=location,
                work_mode=guess_work_mode(location, job["title"]),
                raw=job,
            )
        )
    return postings
