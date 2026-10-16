"""Hard filters (FR10): cheap, deterministic, and run before any model call."""

from dataclasses import dataclass, field

from pydantic import BaseModel

from jobcopilot.enums import WorkMode
from jobcopilot.text import normalize_company, normalize_title


class Preferences(BaseModel):
    """Stored in users.preferences. Empty lists mean "no constraint"."""

    locations: list[str] = []
    work_modes: list[WorkMode] = []
    min_salary: int | None = None  # annual, INR
    excluded_companies: list[str] = []
    title_include: list[str] = []
    title_exclude: list[str] = []
    # Jobs that pass the filters and score at least this are shortlisted without asking.
    shortlist_score: int = 60


@dataclass(frozen=True)
class JobFacts:
    company: str
    title: str
    location: str | None
    work_mode: WorkMode
    salary_max: int | None


@dataclass
class FilterResult:
    passed: bool
    reasons: list[str] = field(default_factory=list)  # why it failed
    notes: list[str] = field(default_factory=list)  # passed, but only because data was missing


def apply_hard_filters(job: JobFacts, prefs: Preferences) -> FilterResult:
    result = FilterResult(passed=True)

    def fail(reason: str) -> None:
        result.passed = False
        result.reasons.append(reason)

    if normalize_company(job.company) in {normalize_company(c) for c in prefs.excluded_companies}:
        fail(f"company {job.company} is excluded")

    title = normalize_title(job.title)
    for term in prefs.title_exclude:
        if normalize_title(term) in title:
            fail(f"title contains excluded term '{term}'")
    if prefs.title_include and not any(normalize_title(t) in title for t in prefs.title_include):
        fail(f"title matches none of {prefs.title_include}")

    if prefs.work_modes:
        if job.work_mode == WorkMode.UNKNOWN:
            result.notes.append("work mode unknown")
        elif job.work_mode not in prefs.work_modes:
            fail(f"work mode {job.work_mode} not in {[str(m) for m in prefs.work_modes]}")

    if prefs.locations and job.work_mode != WorkMode.REMOTE:
        if not job.location:
            result.notes.append("location unknown")
        elif not any(loc.lower() in job.location.lower() for loc in prefs.locations):
            fail(f"location {job.location} not in {prefs.locations}")

    if prefs.min_salary is not None:
        if job.salary_max is None:
            result.notes.append("salary not disclosed")
        elif job.salary_max < prefs.min_salary:
            fail(f"max salary {job.salary_max} below minimum {prefs.min_salary}")

    return result
