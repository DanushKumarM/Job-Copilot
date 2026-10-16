"""Model-based requirement extraction: grounded in the description, retires rather than deletes, and
leaves the rule output alone when the model fails or is unreachable."""

import json

import httpx
import pytest
from sqlalchemy import func, select
from test_integration import backend_job, user  # noqa: F401 - user is a fixture

from jobcopilot import worker
from jobcopilot.enums import Importance
from jobcopilot.ingestion.models import Job, JobRequirement
from jobcopilot.llm.base import LLMResponse
from jobcopilot.matching import service as matching
from jobcopilot.matching.extraction import ExtractionOutput, ExtractionUnavailable, ground
from jobcopilot.matching.models import RequirementMatch

DESCRIPTION = """We build payments infrastructure.
Requirements
- 3+ years of professional software development experience
- Strong Python
- Experience with PostgreSQL and REST APIs
Nice to have
- Kafka
"""

MODEL_OUTPUT = {
    "requirements": [
        {"statement": "3+ years building software professionally", "importance": "must", "terms": [], "min_years": 3},
        {"statement": "Strong Python", "importance": "must", "terms": ["Python"], "min_years": None},
        {"statement": "PostgreSQL and REST APIs", "importance": "must", "terms": ["postgres", "REST APIs"]},
        {"statement": "Kafka", "importance": "preferred", "terms": ["kafka"]},
        # Not in the description: a model must not be able to add these.
        {"statement": "Kubernetes in production", "importance": "must", "terms": ["kubernetes"]},
        {"statement": "10 years of Go", "importance": "must", "terms": ["golang"], "min_years": 10},
    ]
}


class ExtractorLLM:
    name, model, allows_personal_data, billable = "fake", "fake-extract", False, False

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = 0

    def complete_json(self, system, prompt, schema):
        self.calls += 1
        output = self.outputs.pop(0) if len(self.outputs) > 1 else self.outputs[0]
        return LLMResponse(output if isinstance(output, str) else json.dumps(output))


class DownLLM(ExtractorLLM):
    def __init__(self):
        super().__init__([])

    def complete_json(self, system, prompt, schema):
        raise httpx.ConnectError("connection refused")


def test_grounding_drops_what_the_description_does_not_say():
    drafts = ground(ExtractionOutput.model_validate(MODEL_OUTPUT), DESCRIPTION)
    assert [(d.terms, d.min_years, d.importance) for d in drafts] == [
        ([], 3.0, Importance.MUST),
        (["python"], None, Importance.MUST),
        (["postgresql", "rest"], None, Importance.MUST),
        (["kafka"], None, Importance.PREFERRED),
    ]


def test_free_text_terms_count_when_the_description_uses_them():
    output = ExtractionOutput.model_validate(
        {"requirements": [{"statement": "Distributed systems", "importance": "must", "terms": ["distributed systems"]}]}
    )
    assert ground(output, "You know distributed systems well.")[0].terms == ["distributed systems"]
    assert ground(output, "You know Python.") == []


def _active(session, job):
    return session.scalars(
        select(JobRequirement).where(JobRequirement.job_id == job.id, JobRequirement.retired_at.is_(None))
    ).all()


def test_refinement_retires_rule_requirements_and_rescores(session, user):  # noqa: F811
    job = backend_job(session, user)
    before = matching.evaluate(session, user, job)
    old_matches = session.scalar(
        select(func.count()).select_from(RequirementMatch).where(RequirementMatch.evaluation_id == before.id)
    )
    assert job.extractor_version == "rules-v1"

    llm = ExtractorLLM([MODEL_OUTPUT])
    assert matching.refine_requirements(session, llm, user, job)

    assert job.extractor_version == "llm-v1"
    assert sorted(r.statement for r in _active(session, job)) == [
        "3+ years building software professionally",
        "Kafka",
        "PostgreSQL and REST APIs",
        "Strong Python",
    ]
    after = matching.latest_evaluation(session, user.id, job.id)
    assert after.id != before.id and after.score == 70  # the score is still arithmetic in code
    # The old evaluation still explains itself: its matches point at the retired requirements.
    assert old_matches == session.scalar(
        select(func.count()).select_from(RequirementMatch).where(RequirementMatch.evaluation_id == before.id)
    )


def test_unusable_model_output_keeps_the_rule_requirements(session, user):  # noqa: F811
    job = backend_job(session, user)
    rules = {r.id for r in _active(session, job)}
    llm = ExtractorLLM(["not json", {"wrong": "shape"}])
    assert not matching.refine_requirements(session, llm, user, job)
    assert llm.calls == 2 and job.extractor_version == "llm-v1:failed"
    assert {r.id for r in _active(session, job)} == rules

    # Valid JSON that grounds to nothing is a failure too, not an empty requirement list.
    job2 = backend_job(session, user)
    invented = {"requirements": [{"statement": "Kubernetes", "importance": "must", "terms": ["kubernetes"]}]}
    assert not matching.refine_requirements(session, ExtractorLLM([invented]), user, job2)
    assert _active(session, job2)


def test_unreachable_provider_changes_nothing(session, user):  # noqa: F811
    job = backend_job(session, user)
    with pytest.raises(ExtractionUnavailable):
        matching.refine_requirements(session, DownLLM(), user, job)
    assert job.extractor_version == "rules-v1"


def test_worker_refines_open_jobs_once(session, user):  # noqa: F811
    job = backend_job(session, user)
    frontend = session.scalars(select(Job).where(Job.title == "Senior Frontend Engineer")).one()
    for j in (job, frontend):
        matching.evaluate(session, user, j)

    react = {"requirements": [{"statement": "React", "importance": "must", "terms": ["react"]}]}

    class PerJob(ExtractorLLM):
        def complete_json(self, system, prompt, schema):
            self.calls += 1
            return LLMResponse(json.dumps(react if "React" in prompt else MODEL_OUTPUT))

    llm = PerJob([])
    assert worker.run_requirement_refinement(session, user, llm) == 2
    assert worker.run_requirement_refinement(session, user, llm) == 0  # nothing left to refine
    assert llm.calls == 2

    # A provider outage stops the run without marking jobs as failed.
    job.extractor_version = "rules-v1"
    session.commit()
    assert worker.run_requirement_refinement(session, user, DownLLM()) == 0
    session.refresh(job)
    assert job.extractor_version == "rules-v1"
