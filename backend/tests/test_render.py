"""PDF rendering: only approved content, real text (not images), and no crash without a TrueType font."""

from pathlib import Path

import pytest
from pypdf import PdfReader
from test_integration import backend_job, user  # noqa: F401 - user is a fixture

from jobcopilot.enums import Actor, DocumentKind
from jobcopilot.errors import DomainError
from jobcopilot.generation import render, service as generation
from jobcopilot.generation.validator import ClaimDraft, DocumentDraft
from jobcopilot.lifecycle import service as lifecycle
from jobcopilot.matching import service as matching
from jobcopilot.profile import service as profile


def prepared(session, user):  # noqa: F811
    job = backend_job(session, user)
    matching.evaluate(session, user, job)
    app, _ = lifecycle.get_or_create_application(session, user.id, job.id)
    facts = {f.statement: f.id for f in profile.list_facts(session, user.id)}
    billing = next(i for s, i in facts.items() if "billing" in s)
    years = next(i for s, i in facts.items() if "4 years" in s)
    generation.save_version(
        session,
        app,
        DocumentKind.RESUME_BULLETS,
        DocumentDraft(
            claims=[
                ClaimDraft(body="Built Python billing services handling 2 million invoices a month", fact_ids=[billing])
            ]
        ),
        Actor.SYSTEM,
    )
    generation.save_version(
        session,
        app,
        DocumentKind.SUMMARY,
        DocumentDraft(
            claims=[ClaimDraft(body="Backend engineer — 4 years building backend systems", fact_ids=[years])]
        ),
        Actor.SYSTEM,
    )
    profile.upsert_answer(session, user.id, "full_name", "Full name", "Asha Rao")
    profile.upsert_answer(session, user.id, "email", "Email", "asha@example.com")
    profile.upsert_answer(session, user.id, "notice_period", "What is your notice period?", "30 days")
    return app


def text_of(path: Path) -> str:
    return "\n".join(page.extract_text() for page in PdfReader(path).pages)


def test_nothing_renders_before_approval(session, user):  # noqa: F811
    app = prepared(session, user)
    with pytest.raises(DomainError, match="approve"):
        render.render_resume(session, app)


def test_resume_and_answers_contain_only_approved_content(session, user):  # noqa: F811
    app = prepared(session, user)
    generation.approve(session, app, app.lock_version)

    path = render.render_resume(session, app)
    text = text_of(path)
    assert "Asha Rao" in text and "asha@example.com" in text
    assert "Built Python billing services handling 2 million invoices a month" in text
    assert "Backend engineer — 4 years" in text
    assert "PostgreSQL" in text  # verified skill facts, written for people
    resume_doc = generation.approved_documents(session, app)[DocumentKind.RESUME_BULLETS]
    assert resume_doc.rendered_path == str(path) and path.name == "resume-v1.pdf"

    answers = text_of(render.render_answers(session, app))
    assert "What is your notice period?" in answers and "30 days" in answers


def test_falls_back_to_a_core_font_without_truetype(session, user, monkeypatch):  # noqa: F811
    app = prepared(session, user)
    generation.approve(session, app, app.lock_version)
    monkeypatch.setattr(render, "_FONT_CANDIDATES", [])
    text = text_of(render.render_resume(session, app))
    assert "Backend engineer - 4 years" in text


def test_resume_overflow_guard_guarantees_single_page(session, user):  # noqa: F811
    app = prepared(session, user)
    facts = {f.statement: f.id for f in profile.list_facts(session, user.id)}
    billing = next(i for s, i in facts.items() if "billing" in s)

    # Inundate with 15 bulky bullets that would ordinarily overflow to 2-3 pages
    long_bullets = [
        ClaimDraft(
            body=f"High scale billing component #{i}: engineered fault-tolerant distributed transaction handlers processing large scale transaction volume with asynchronous retry policies",
            fact_ids=[billing],
        )
        for i in range(1, 16)
    ]
    generation.save_version(
        session,
        app,
        DocumentKind.RESUME_BULLETS,
        DocumentDraft(claims=long_bullets),
        Actor.USER,
    )
    generation.approve(session, app, app.lock_version)

    path = render.render_resume(session, app)
    reader = PdfReader(path)
    assert len(reader.pages) == 1, f"Expected strictly 1 page, got {len(reader.pages)}"
