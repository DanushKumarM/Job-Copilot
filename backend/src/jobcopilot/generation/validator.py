"""The citation validator: the mechanism behind "no fabrication" (design 12.3, FR15).

A claim passes only if it cites at least one verified fact owned by the user, and every skill term and
number it mentions also appears in a fact it cites. The second rule is what rejects
"Built Kafka pipelines" citing a fact that only mentions Python.
"""

import uuid
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from jobcopilot.enums import FactStatus
from jobcopilot.text import canonical_term, find_numbers, find_terms


class ClaimDraft(BaseModel):
    """The structured output we require from the model: claim text plus the facts it rests on."""

    body: str = Field(min_length=1, max_length=600)
    fact_ids: list[uuid.UUID]


class DocumentDraft(BaseModel):
    claims: list[ClaimDraft] = Field(min_length=1, max_length=40)


@dataclass(frozen=True)
class FactView:
    id: uuid.UUID
    user_id: uuid.UUID
    status: str
    statement: str
    details: dict


@dataclass
class ClaimIssue:
    position: int
    body: str
    problems: list[str]


@dataclass
class ValidationReport:
    issues: list[ClaimIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.issues

    def messages(self) -> list[str]:
        return [f"claim {i.position}: {p}" for i in self.issues for p in i.problems]


def fact_terms(fact: FactView, extra_terms: frozenset[str]) -> set[str]:
    skills = {canonical_term(s) for s in fact.details.get("skills", []) if isinstance(s, str)}
    return skills | find_terms(fact.statement, extra_terms)


def fact_numbers(fact: FactView) -> set[str]:
    numbers = find_numbers(fact.statement)
    for value in fact.details.values():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            numbers |= find_numbers(f"{value:g}")
        elif isinstance(value, str):
            numbers |= find_numbers(value)
    return numbers


def validate_claims(
    claims: list[ClaimDraft],
    facts: dict[uuid.UUID, FactView],
    user_id: uuid.UUID,
    extra_terms: frozenset[str] = frozenset(),
) -> ValidationReport:
    """Check every claim. `facts` should contain every fact the claims cite (missing = unknown)."""
    report = ValidationReport()
    for position, claim in enumerate(claims):
        problems: list[str] = []
        cited: list[FactView] = []

        if not claim.fact_ids:
            problems.append("cites no facts")
        for fact_id in claim.fact_ids:
            fact = facts.get(fact_id)
            if fact is None or fact.user_id != user_id:
                problems.append(f"cites unknown fact {fact_id}")
            elif fact.status != FactStatus.VERIFIED:
                problems.append(f"cites {fact.status} fact {fact_id}; only verified facts may be used")
            else:
                cited.append(fact)

        if cited:
            supported_terms = set().union(*(fact_terms(f, extra_terms) for f in cited))
            unsupported = find_terms(claim.body, extra_terms) - supported_terms
            if unsupported:
                problems.append(f"mentions {', '.join(sorted(unsupported))} not found in cited facts")

            supported_numbers = set().union(*(fact_numbers(f) for f in cited))
            stray = find_numbers(claim.body) - supported_numbers
            if stray:
                problems.append(f"uses numbers {', '.join(sorted(stray))} not found in cited facts")

        if problems:
            report.issues.append(ClaimIssue(position, claim.body, problems))
    return report
