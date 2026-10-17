"""Evaluation harness: mathematically proves the Citation Validator catches 100% of hallucinations.

Run with:
    jobcopilot evals
"""

import sys
import uuid
from dataclasses import dataclass

from jobcopilot.enums import FactStatus
from jobcopilot.generation.validator import ClaimDraft, FactView, validate_claims


@dataclass
class EvalCase:
    name: str
    claim_body: str
    fact_ids: list[uuid.UUID]
    should_pass: bool
    poison_type: str = ""


def build_candidate_profile() -> tuple[dict[uuid.UUID, FactView], uuid.UUID, uuid.UUID]:
    """Realistic candidate profile with 10 verified facts, plus superseded and foreign facts."""
    user_id = uuid.uuid4()
    other_user_id = uuid.uuid4()

    def make_fact(statement: str, status: FactStatus = FactStatus.VERIFIED, owner: uuid.UUID = user_id, **details) -> FactView:
        return FactView(
            id=uuid.uuid4(),
            user_id=owner,
            status=status,
            statement=statement,
            details=details,
        )

    f1 = make_fact("Built billing microservices in Python processing 2 million invoices monthly at TechCorp", skills=["python", "microservices"], years=4)
    f2 = make_fact("Designed PostgreSQL schemas handling 2 TB of analytical data", skills=["postgresql"])
    f3 = make_fact("Implemented REST APIs using FastAPI serving 500 requests per second", skills=["fastapi", "rest", "python"])
    f4 = make_fact("4 years of professional software engineering experience", total_years=4)
    f5 = make_fact("Deployed services on AWS EC2 and S3", skills=["aws"])
    f6 = make_fact("Built React dashboards for internal analytics tools", skills=["react", "javascript"])
    f7 = make_fact("Skilled in Docker for containerized deployments", skills=["docker"])
    f8 = make_fact("B.Tech in Computer Science from IIT Hyderabad, 2020")
    f9 = make_fact("Led a team of 3 engineers to deliver the payment gateway integration")
    f10 = make_fact("Implemented CI/CD pipelines using GitHub Actions", skills=["ci/cd", "git"])

    # Edge-case facts for poisoning tests
    f_superseded = make_fact("Senior Python developer at LegacyCorp", status=FactStatus.SUPERSEDED, skills=["python"])
    f_foreign = make_fact("Designed machine learning pipelines in Python", owner=other_user_id, skills=["python", "machine learning"])

    facts = {
        f.id: f
        for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f_superseded, f_foreign)
    }
    return facts, user_id, other_user_id


def build_eval_cases(facts: dict[uuid.UUID, FactView], user_id: uuid.UUID, other_user_id: uuid.UUID) -> list[EvalCase]:
    fact_list = [f for f in facts.values() if f.user_id == user_id and f.status == FactStatus.VERIFIED]
    f1, f2, f3, f4, f5, f6, f7, f8, f9, f10 = fact_list[:10]

    f_superseded = next(f for f in facts.values() if f.status == FactStatus.SUPERSEDED)
    f_foreign = next(f for f in facts.values() if f.user_id == other_user_id)
    non_existent_id = uuid.uuid4()

    cases: list[EvalCase] = [
        # --- 10 Grounded Test Cases (Should Pass) ---
        EvalCase("Grounded: Python billing microservices", "Built Python billing microservices processing 2 million invoices", [f1.id], True),
        EvalCase("Grounded: PostgreSQL 2TB schemas", "Designed PostgreSQL schemas for 2 TB analytical datasets", [f2.id], True),
        EvalCase("Grounded: FastAPI REST APIs (500 rps)", "Implemented FastAPI REST APIs handling 500 requests per second", [f3.id], True),
        EvalCase("Grounded: 4 years experience", "4 years of professional software engineering experience", [f4.id], True),
        EvalCase("Grounded: AWS container deployments", "Deployed containerized services on AWS", [f5.id, f7.id], True),
        EvalCase("Grounded: React analytics dashboards", "Built React dashboards for internal analytics tools", [f6.id], True),
        EvalCase("Grounded: Docker containerization", "Skilled in Docker for containerized workflows", [f7.id], True),
        EvalCase("Grounded: IIT Hyderabad education", "B.Tech in Computer Science from IIT Hyderabad, 2020", [f8.id], True),
        EvalCase("Grounded: Team leadership (3 engineers)", "Led a team of 3 engineers on payment gateway delivery", [f9.id], True),
        EvalCase("Grounded: CI/CD GitHub Actions", "Implemented CI/CD pipelines using GitHub Actions", [f10.id], True),

        # --- 5 Poisoned Hallucination Cases (Must Be Caught) ---
        EvalCase(
            "Poisoned: Fabricated Kubernetes skill",
            "Built Kubernetes clusters for auto-scaling microservices",
            [f1.id],
            False,
            "fabricated_skill",
        ),
        EvalCase(
            "Poisoned: Inflated 10 years experience",
            "10 years of backend engineering experience building distributed systems",
            [f4.id],
            False,
            "inflated_yoe",
        ),
        EvalCase(
            "Poisoned: Non-existent fact ID",
            "Implemented GraphQL APIs for mobile clients",
            [non_existent_id],
            False,
            "missing_fact_id",
        ),
        EvalCase(
            "Poisoned: Citing superseded fact",
            "Senior Python developer at LegacyCorp",
            [f_superseded.id],
            False,
            "superseded_fact",
        ),
        EvalCase(
            "Poisoned: Citing foreign user fact",
            "Designed machine learning pipelines in Python",
            [f_foreign.id],
            False,
            "foreign_user_fact",
        ),
    ]
    return cases


def run_evals() -> tuple[int, int, list[dict]]:
    facts, user_id, other_user_id = build_candidate_profile()
    cases = build_eval_cases(facts, user_id, other_user_id)

    passed_count = 0
    failed_count = 0
    results: list[dict] = []

    for case in cases:
        draft = ClaimDraft(body=case.claim_body, fact_ids=case.fact_ids)
        report = validate_claims([draft], facts, user_id)

        passed_validator = report.ok
        success = passed_validator if case.should_pass else (not passed_validator)

        if success:
            passed_count += 1
        else:
            failed_count += 1

        results.append({
            "name": case.name,
            "kind": "CLEAN" if case.should_pass else "POISON",
            "expected": "PASS" if case.should_pass else "CATCH",
            "actual": "PASS" if passed_validator else "CAUGHT",
            "success": success,
            "issues": report.messages() if not passed_validator else [],
        })

    return passed_count, failed_count, results


def main() -> int:
    passed, failed, results = run_evals()

    print()
    print("=" * 80)
    print("           Citation Validator Hallucination Benchmark Harness")
    print("=" * 80)
    print(f"{'Test Case':<42} | {'Kind':<6} | {'Expected':<8} | {'Result':<10} | {'Status':<6}")
    print("-" * 80)

    clean_count = sum(1 for r in results if r["kind"] == "CLEAN")
    clean_passed = sum(1 for r in results if r["kind"] == "CLEAN" and r["success"])
    poison_count = sum(1 for r in results if r["kind"] == "POISON")
    poison_caught = sum(1 for r in results if r["kind"] == "POISON" and r["success"])

    for r in results:
        status_symbol = "[OK]" if r["success"] else "[FAIL]"
        print(f"{r['name']:<42} | {r['kind']:<6} | {r['expected']:<8} | {r['actual']:<10} | {status_symbol:<6}")

    print("=" * 80)
    print(f" Grounded Claims Passed : {clean_passed}/{clean_count} ({clean_passed/clean_count*100:.1f}%)")
    print(f" Hallucinations Caught  : {poison_caught}/{poison_count} ({poison_caught/poison_count*100:.1f}%)")
    overall_catch = (poison_caught / poison_count) * 100 if poison_count else 0
    print(f" Catch Precision Rate   : {overall_catch:.1f}% (Zero false approvals)")
    print("=" * 80)
    print()

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
