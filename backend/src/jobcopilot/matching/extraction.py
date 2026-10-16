"""Requirement extraction with a model (FR11), grounded in the job description.

The model proposes requirements; code keeps only what the description supports. A term the text never
mentions is dropped, and so is a years figure that does not appear in it, so a model cannot add a
requirement the employer did not write. The output has the same shape as the rule extractor's, and the
score is still computed in code from it (design 12.4).

Job descriptions are public, so this call carries no personal data and may use a free hosted tier.
"""

import re
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from jobcopilot.enums import Importance
from jobcopilot.llm.base import PROVIDER_ERROR, LLMProvider, call_structured
from jobcopilot.matching.scoring import RequirementDraft
from jobcopilot.text import canonical_term, find_numbers, find_terms

LLM_EXTRACTOR_VERSION = "llm-v1"
FAILED_VERSION = f"{LLM_EXTRACTOR_VERSION}:failed"
PROMPT_VERSION = "extract-v1"
MAX_ATTEMPTS = 2
MAX_DESCRIPTION_CHARS = 12_000

SYSTEM = """You extract the requirements from one job description.
Rules:
- One requirement per distinct skill, tool, qualification or experience level the employer asks for.
- importance is "must" for required items and "preferred" for nice-to-have, bonus or "a plus" items.
- terms: 1-4 short lower-case keywords copied from the description (e.g. "python", "kafka", "system design").
- min_years: the number of years the description states for this requirement, else null.
- statement: a short paraphrase of the requirement. Skip benefits, company blurb and duties.
Return JSON matching the schema."""


class ExtractedRequirement(BaseModel):
    statement: str = Field(min_length=2, max_length=300)
    importance: Literal["must", "preferred"]
    terms: list[str] = Field(default_factory=list, max_length=8)
    min_years: float | None = None


class ExtractionOutput(BaseModel):
    requirements: list[ExtractedRequirement] = Field(max_length=40)


class ExtractionUnavailable(Exception):
    """The provider could not be reached; try again later rather than counting it as a failure."""


def _mentioned(term: str, description: str) -> bool:
    if term in find_terms(description):
        return True
    return re.search(r"(?<![\w+#.])" + re.escape(term) + r"(?![\w+#])", description, re.IGNORECASE) is not None


def ground(output: ExtractionOutput, description: str) -> list[RequirementDraft]:
    """Keep what the description supports: its terms, its years figures, nothing else."""
    numbers = find_numbers(description)
    drafts: list[RequirementDraft] = []
    seen: set[tuple[str, ...]] = set()
    for item in output.requirements:
        terms = sorted({canonical_term(t) for t in item.terms if 1 < len(t.strip()) <= 40} - {""})
        terms = [t for t in terms if _mentioned(t, description)]
        years = item.min_years if item.min_years and f"{item.min_years:g}" in numbers else None
        if not terms and years is None:
            continue  # nothing the score could check against a fact
        key = (*terms, f"{years}")
        if key in seen:
            continue
        seen.add(key)
        drafts.append(RequirementDraft(item.statement.strip(), Importance(item.importance), terms, years))
    return drafts


def extract_with_llm(session: Session, provider: LLMProvider, description: str) -> list[RequirementDraft] | None:
    """Grounded requirements, or None if the model never produced usable output.

    Raises ExtractionUnavailable when the provider is down, so the caller can leave the job for later.
    """
    prompt = "Job description:\n\n" + description[:MAX_DESCRIPTION_CHARS]
    for _ in range(MAX_ATTEMPTS):
        output, error = call_structured(
            session,
            provider,
            ExtractionOutput,
            purpose="extract.requirements",
            prompt_version=PROMPT_VERSION,
            system=SYSTEM,
            prompt=prompt,
            contains_personal_data=False,
        )
        if output is not None:
            return ground(output, description)
        if error and error.startswith(PROVIDER_ERROR):
            raise ExtractionUnavailable(error)
    return None
