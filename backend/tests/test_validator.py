import uuid

from jobcopilot.enums import FactStatus
from jobcopilot.generation.validator import ClaimDraft, FactView, validate_claims

USER = uuid.uuid4()
OTHER_USER = uuid.uuid4()


def fact(statement: str, status: FactStatus = FactStatus.VERIFIED, user=USER, **details) -> FactView:
    return FactView(uuid.uuid4(), user, status, statement, details)


PY = fact("Built billing services in Python at Acme", skills=["Python"], years=4)
PG = fact("Designed PostgreSQL schemas handling 2 TB of data", skills=["PostgreSQL"])
FACTS = {f.id: f for f in (PY, PG)}


def check(body: str, *cited: FactView, facts=FACTS):
    return validate_claims([ClaimDraft(body=body, fact_ids=[f.id for f in cited])], facts, USER)


def test_grounded_claim_passes():
    assert check("Built Python billing services backed by PostgreSQL", PY, PG).ok


def test_uncited_claim_is_rejected():
    report = check("Shipped many services")
    assert report.messages() == ["claim 0: cites no facts"]


def test_kafka_claim_citing_python_fact_is_rejected():
    # The worked example from design 4.2: Kafka is a gap, so a Kafka bullet must not pass.
    report = check("Built Kafka streaming pipelines in Python", PY)
    assert not report.ok
    assert "kafka" in report.messages()[0]


def test_invented_number_is_rejected():
    report = check("Designed PostgreSQL schemas handling 10 TB of data", PG)
    assert "10" in report.messages()[0]


def test_numbers_from_details_count_as_grounded():
    assert check("4 years of Python", PY).ok


def test_unverified_superseded_and_foreign_facts_are_rejected():
    proposed = fact("Python expert", FactStatus.PROPOSED, skills=["Python"])
    superseded = fact("Python expert", FactStatus.SUPERSEDED, skills=["Python"])
    foreign = fact("Python expert", user=OTHER_USER, skills=["Python"])
    facts = {f.id: f for f in (proposed, superseded, foreign)}
    for f in facts.values():
        assert not check("Python expert", f, facts=facts).ok


def test_unknown_fact_id_is_rejected():
    report = validate_claims([ClaimDraft(body="Python", fact_ids=[uuid.uuid4()])], FACTS, USER)
    assert "unknown fact" in report.messages()[0]


def test_alias_spelling_is_grounded():
    assert check("Tuned Postgres queries", PG).ok
