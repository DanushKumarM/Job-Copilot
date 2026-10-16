import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from jobcopilot.enums import Actor, AppStatus, FactStatus, Importance
from jobcopilot.ingestion.models import Company, Job, JobRequirement
from jobcopilot.ingestion.service import replace_requirements
from jobcopilot.lifecycle import service as lifecycle
from jobcopilot.llm.base import LLMProvider
from jobcopilot.matching.extraction import FAILED_VERSION, LLM_EXTRACTOR_VERSION, extract_with_llm
from jobcopilot.matching.filters import JobFacts, Preferences, apply_hard_filters
from jobcopilot.matching.models import MatchEvaluation, RequirementMatch
from jobcopilot.matching.scoring import SCORER_VERSION, RequirementView, map_requirements, score
from jobcopilot.profile.models import User
from jobcopilot.profile.service import fact_views, list_facts


def requirement_views(session: Session, job_id: uuid.UUID) -> list[RequirementView]:
    rows = session.scalars(
        select(JobRequirement).where(JobRequirement.job_id == job_id, JobRequirement.retired_at.is_(None))
    )
    return [RequirementView(r.id, r.statement, Importance(r.importance), r.terms, r.min_years) for r in rows]


def evaluate(session: Session, user: User, job: Job) -> MatchEvaluation:
    """Hard filters, then mapping and score. Persists a new evaluation; history is kept."""
    prefs = Preferences.model_validate(user.preferences or {})
    company = session.get(Company, job.company_id)
    filters = apply_hard_filters(JobFacts(company.name, job.title, job.location, job.work_mode, job.salary_max), prefs)

    requirements = requirement_views(session, job.id)
    facts = fact_views(list_facts(session, user.id, [FactStatus.VERIFIED])).values()
    mappings = map_requirements(requirements, list(facts)) if filters.passed else []
    value, breakdown = score(requirements, mappings) if filters.passed else (0, {"scorer_version": SCORER_VERSION})
    breakdown["filter_notes"] = filters.notes

    evaluation = MatchEvaluation(
        job_id=job.id,
        user_id=user.id,
        scorer_version=SCORER_VERSION,
        score=value,
        breakdown=breakdown,
        hard_filter_pass=filters.passed,
        hard_filter_reasons=filters.reasons,
    )
    session.add(evaluation)
    session.flush()
    for m in mappings:
        session.add(
            RequirementMatch(
                evaluation_id=evaluation.id,
                requirement_id=m.requirement_id,
                fact_id=m.fact_id,
                coverage=m.coverage,
                rationale=m.rationale,
            )
        )

    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    if app.status == AppStatus.DISCOVERED:
        if not filters.passed:
            lifecycle.transition(
                session, app, AppStatus.REJECTED_BY_RULES, Actor.SYSTEM, note="; ".join(filters.reasons)
            )
        elif value >= prefs.shortlist_score:
            lifecycle.transition(session, app, AppStatus.SHORTLISTED, Actor.SYSTEM, note=f"score {value}")
    elif app.status == AppStatus.REJECTED_BY_RULES and filters.passed and value >= prefs.shortlist_score:
        # Preferences were loosened or the profile grew since the job was filtered out.
        lifecycle.transition(session, app, AppStatus.SHORTLISTED, Actor.SYSTEM, note=f"re-scored: {value}")
    session.flush()
    return evaluation


def latest_evaluation(session: Session, user_id: uuid.UUID, job_id: uuid.UUID) -> MatchEvaluation | None:
    return session.scalars(
        select(MatchEvaluation)
        .where(MatchEvaluation.user_id == user_id, MatchEvaluation.job_id == job_id)
        .order_by(MatchEvaluation.created_at.desc())
        .limit(1)
    ).first()


def refine_requirements(session: Session, provider: LLMProvider, user: User, job: Job) -> bool:
    """Replace a job's rule-extracted requirements with grounded model output, then re-score.

    Returns True if the requirements changed. A model that gives nothing usable leaves the rule
    requirements in place and marks the job, so it is not retried on every run. Raises
    ExtractionUnavailable (nothing recorded) when the provider is down.
    """
    drafts = extract_with_llm(session, provider, job.description)
    if not drafts:
        job.extractor_version = FAILED_VERSION
        session.flush()
        return False
    replace_requirements(session, job, drafts, LLM_EXTRACTOR_VERSION)
    evaluate(session, user, job)
    return True
