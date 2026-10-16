"""Requirement extraction (rules), requirement-to-fact mapping, and the score (design 12.4).

The score is arithmetic over the mapping with visible weights. An LLM may later propose requirements
and mappings, but it never produces the number.
"""

import re
import uuid
from dataclasses import dataclass, field

from jobcopilot.enums import Coverage, FactStatus, Importance
from jobcopilot.generation.validator import FactView, fact_terms
from jobcopilot.text import find_terms

SCORER_VERSION = "score-v1"
RULE_EXTRACTOR_VERSION = "rules-v1"

GROUP_WEIGHTS = {Importance.MUST: 0.7, Importance.PREFERRED: 0.3}
COVERAGE_VALUE = {Coverage.FULL: 1.0, Coverage.PARTIAL: 0.5, Coverage.GAP: 0.0}
_COVERAGE_RANK = {Coverage.GAP: 0, Coverage.PARTIAL: 1, Coverage.FULL: 2}


@dataclass
class RequirementDraft:
    statement: str
    importance: Importance
    terms: list[str] = field(default_factory=list)
    min_years: float | None = None


@dataclass
class RequirementView:
    id: uuid.UUID
    statement: str
    importance: Importance
    terms: list[str]
    min_years: float | None


@dataclass
class Mapping:
    requirement_id: uuid.UUID
    fact_id: uuid.UUID | None
    coverage: Coverage
    rationale: str


# --- extraction ---------------------------------------------------------------------------------

_PREFERRED_HEADING = re.compile(r"(nice to have|good to have|preferred|bonus|plus|desirable|optional)", re.IGNORECASE)
_MUST_HEADING = re.compile(
    r"(requirements|required|must have|qualifications|what you.ll need|what we.re looking for|"
    r"you have|skills)",
    re.IGNORECASE,
)
_YEARS = re.compile(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?)", re.IGNORECASE)
_PREFERRED_INLINE = re.compile(r"\b(preferred|nice to have|good to have|a plus|bonus)\b", re.IGNORECASE)
_BULLET = re.compile(r"^\s*(?:[-*•·▪◦]|\d+[.)])\s+")


def extract_requirements(description: str) -> list[RequirementDraft]:
    """Rule-based extraction from a job description: bullet lines with known skills or years.

    Heading context decides must vs preferred; an inline "preferred" overrides it. Good enough to
    work offline; an LLM extractor can replace it behind the same output type.
    """
    drafts: list[RequirementDraft] = []
    seen_terms: set[str] = set()
    section = Importance.MUST
    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        is_bullet = bool(_BULLET.match(line))
        if not is_bullet and len(line) < 80:
            if _PREFERRED_HEADING.search(line):
                section = Importance.PREFERRED
                continue
            if _MUST_HEADING.search(line):
                section = Importance.MUST
                continue
        text = _BULLET.sub("", line)
        terms = sorted(find_terms(text) - seen_terms)
        years_match = _YEARS.search(text)
        min_years = float(years_match.group(1)) if years_match else None
        if not terms and min_years is None:
            continue
        importance = Importance.PREFERRED if _PREFERRED_INLINE.search(text) else section
        seen_terms.update(terms)
        if min_years is not None and terms:
            # "3+ years of Python" is one requirement; keep years attached to it.
            drafts.append(RequirementDraft(text, importance, terms, min_years))
        elif min_years is not None:
            drafts.append(RequirementDraft(text, importance, [], min_years))
        else:
            # A line listing several skills becomes one requirement per skill, so each can be mapped.
            for term in terms:
                drafts.append(RequirementDraft(f"{term} ({text})", importance, [term]))
    return drafts


# --- mapping ------------------------------------------------------------------------------------


def _fact_years(fact: FactView) -> float | None:
    years = fact.details.get("years")
    return float(years) if isinstance(years, (int, float)) and not isinstance(years, bool) else None


def map_requirements(requirements: list[RequirementView], facts: list[FactView]) -> list[Mapping]:
    """Deterministic baseline mapping: shared skill terms, and years from experience facts."""
    verified = [f for f in facts if f.status == FactStatus.VERIFIED]
    # Overall experience comes from a fact like "4 years as a software engineer" {"total_years": 4}.
    career = max(
        (
            (float(y), f)
            for f in verified
            if isinstance(y := f.details.get("total_years"), (int, float)) and not isinstance(y, bool)
        ),
        key=lambda pair: pair[0],
        default=None,
    )
    mappings: list[Mapping] = []
    for req in requirements:
        found: list[Mapping] = []
        for fact in verified:
            shared = set(req.terms) & fact_terms(fact, frozenset(req.terms))
            if not shared:
                continue
            coverage, why = Coverage.FULL, f"fact mentions {', '.join(sorted(shared))}"
            if req.min_years is not None:
                years = _fact_years(fact)
                if years is None:
                    coverage, why = Coverage.PARTIAL, why + "; years of use not stated"
                elif years < req.min_years:
                    coverage, why = Coverage.PARTIAL, why + f"; {years:g} of {req.min_years:g} years"
            found.append(Mapping(req.id, fact.id, coverage, why))
        if not found and not req.terms and req.min_years is not None and career is not None:
            years, fact = career
            coverage = Coverage.FULL if years >= req.min_years else Coverage.PARTIAL
            found.append(Mapping(req.id, fact.id, coverage, f"{years:g} years total vs {req.min_years:g} required"))
        mappings.extend(found or [Mapping(req.id, None, Coverage.GAP, "no supporting verified fact")])
    return mappings


# --- scoring ------------------------------------------------------------------------------------


def score(requirements: list[RequirementView], mappings: list[Mapping]) -> tuple[int, dict]:
    """Return (0-100 score, breakdown). Each requirement counts at its best coverage."""
    best: dict[uuid.UUID, Coverage] = {}
    for m in mappings:
        if _COVERAGE_RANK[m.coverage] >= _COVERAGE_RANK[best.get(m.requirement_id, Coverage.GAP)]:
            best[m.requirement_id] = m.coverage

    groups: dict[Importance, list[float]] = {Importance.MUST: [], Importance.PREFERRED: []}
    items = []
    for req in requirements:
        coverage = best.get(req.id, Coverage.GAP)
        groups[req.importance].append(COVERAGE_VALUE[coverage])
        items.append(
            {
                "requirement_id": str(req.id),
                "statement": req.statement,
                "importance": str(req.importance),
                "coverage": str(coverage),
            }
        )

    present = {g: vals for g, vals in groups.items() if vals}
    weight_total = sum(GROUP_WEIGHTS[g] for g in present) or 1.0
    components = {}
    total = 0.0
    for group, values in present.items():
        weight = GROUP_WEIGHTS[group] / weight_total
        group_score = sum(values) / len(values)
        components[str(group)] = {
            "weight": round(weight, 3),
            "coverage": round(group_score, 3),
            "points": round(100 * weight * group_score, 1),
        }
        total += weight * group_score

    breakdown = {
        "scorer_version": SCORER_VERSION,
        "components": components,
        "must_gaps": sum(
            1 for r in requirements if r.importance == Importance.MUST and best.get(r.id, Coverage.GAP) == Coverage.GAP
        ),
        "requirements": items,
    }
    return round(100 * total) if present else 0, breakdown
