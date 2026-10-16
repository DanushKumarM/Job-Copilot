import uuid

from jobcopilot.enums import Coverage, FactStatus, Importance, WorkMode
from jobcopilot.generation.validator import FactView
from jobcopilot.matching.filters import JobFacts, Preferences, apply_hard_filters
from jobcopilot.matching.scoring import RequirementView, extract_requirements, map_requirements, score

USER = uuid.uuid4()

JD = """
Backend Engineer, Bengaluru

Requirements
- 3+ years of professional software development experience
- Strong Python
- Experience with PostgreSQL and REST APIs

Nice to have
- Kafka or RabbitMQ
"""


def views(drafts):
    return [RequirementView(uuid.uuid4(), d.statement, d.importance, d.terms, d.min_years) for d in drafts]


def test_extract_requirements_splits_must_and_preferred():
    drafts = extract_requirements(JD)
    by_term = {t: d.importance for d in drafts for t in d.terms}
    assert by_term["python"] == Importance.MUST
    assert by_term["postgresql"] == Importance.MUST
    assert by_term["kafka"] == Importance.PREFERRED
    years = [d for d in drafts if d.min_years == 3]
    assert years and years[0].importance == Importance.MUST


def test_worked_example_maps_and_flags_kafka_gap():
    reqs = views(extract_requirements(JD))
    facts = [
        FactView(uuid.uuid4(), USER, FactStatus.VERIFIED, "Python services at Acme", {"skills": ["Python"]}),
        FactView(uuid.uuid4(), USER, FactStatus.VERIFIED, "PostgreSQL and REST API design", {}),
        FactView(uuid.uuid4(), USER, FactStatus.VERIFIED, "4 years as a software engineer", {"total_years": 4}),
        # Unverified facts never count.
        FactView(uuid.uuid4(), USER, FactStatus.PROPOSED, "Kafka streaming", {"skills": ["Kafka"]}),
    ]
    mappings = map_requirements(reqs, facts)
    coverage = {
        r.terms[0] if r.terms else "years": c
        for r in reqs
        for m in mappings
        if m.requirement_id == r.id
        for c in [m.coverage]
    }
    assert coverage["python"] == Coverage.FULL
    assert coverage["years"] == Coverage.FULL
    assert coverage["kafka"] == Coverage.GAP

    value, breakdown = score(reqs, mappings)
    # Every must is met; both preferred items (kafka, rabbitmq) are gaps: 70 points.
    assert value == 70
    assert breakdown["must_gaps"] == 0


def test_years_shortfall_is_partial():
    req = RequirementView(uuid.uuid4(), "5+ years Python", Importance.MUST, ["python"], 5)
    fact = FactView(uuid.uuid4(), USER, FactStatus.VERIFIED, "Python", {"skills": ["Python"], "years": 2})
    [m] = map_requirements([req], [fact])
    assert m.coverage == Coverage.PARTIAL
    assert score([req], [m])[0] == 50


def test_hard_filters():
    prefs = Preferences(
        locations=["Bengaluru"],
        work_modes=[WorkMode.HYBRID, WorkMode.REMOTE],
        min_salary=2_500_000,
        excluded_companies=["Globex Pvt Ltd"],
        title_exclude=["intern"],
    )
    ok = JobFacts("Acme", "Backend Engineer", "Bengaluru, KA", WorkMode.HYBRID, 3_000_000)
    assert apply_hard_filters(ok, prefs).passed

    assert not apply_hard_filters(JobFacts("Globex", "Engineer", "Bengaluru", WorkMode.HYBRID, None), prefs).passed
    assert not apply_hard_filters(JobFacts("Acme", "SDE Intern", "Bengaluru", WorkMode.HYBRID, None), prefs).passed
    assert not apply_hard_filters(JobFacts("Acme", "Engineer", "Pune", WorkMode.HYBRID, None), prefs).passed
    assert apply_hard_filters(JobFacts("Acme", "Engineer", "Pune", WorkMode.REMOTE, None), prefs).passed

    unknown = apply_hard_filters(JobFacts("Acme", "Engineer", None, WorkMode.UNKNOWN, None), prefs)
    assert unknown.passed and len(unknown.notes) == 3
