"""PDF rendering of the approved packet (FR21): a tailored resume and an answers sheet.

Everything printed comes from approved, validated claims or from verified facts and the answer bank,
so a rendered PDF carries nothing the validator has not seen. The output is plain text in a single
column with standard headings, which applicant tracking systems parse reliably.

Design 9 names WeasyPrint; it needs GTK, which Windows lacks, so this uses fpdf2 (pure Python).
"""

import uuid
from dataclasses import dataclass
from pathlib import Path

from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.orm import Session

from jobcopilot.config import get_settings
from jobcopilot.enums import DocumentKind, FactKind, FactStatus
from jobcopilot.errors import DomainError
from jobcopilot.generation.latex import escape as latex_escape, render_and_compile
from jobcopilot.generation.service import approved_documents
from jobcopilot.ingestion.models import Company, Job
from jobcopilot.lifecycle.models import Application
from jobcopilot.profile.models import AnswerBankEntry
from jobcopilot.profile.service import CONTACT_FIELDS, is_stale, list_facts
from jobcopilot.text import display_term

_FONT_CANDIDATES = [
    (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
    (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ),
]

# Core PDF fonts only cover Latin-1; used when no TrueType font is installed.
_ASCII = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2022": "-",
        "\u2026": "...",
        "\u20b9": "INR ",
    }
)


class _Doc(FPDF):
    def __init__(self, title: str, author: str | None):
        super().__init__(format="A4")
        self.set_margins(18, 16, 18)
        self.set_auto_page_break(True, margin=16)
        self.set_title(title)
        self.set_creator("job-copilot")
        if author:
            self.set_author(author)
        self._family, self._unicode = "helvetica", False
        regular, bold = _font_files()
        if regular:
            self.add_font("body", "", str(regular))
            self.add_font("body", "B", str(bold or regular))
            self._family, self._unicode = "body", True
        self.add_page()

    def clean(self, text: str) -> str:
        text = " ".join(text.split())
        if self._unicode:
            return text
        return text.translate(_ASCII).encode("latin-1", "replace").decode("latin-1")

    def font(self, size: float, bold: bool = False) -> None:
        self.set_font(self._family, "B" if bold else "", size)

    def heading(self, text: str, size: float = 18) -> None:
        self.font(size, bold=True)
        self.multi_cell(0, size * 0.5, self.clean(text), new_x="LMARGIN", new_y="NEXT")

    def line_text(self, text: str, size: float = 10, bold: bool = False, gap: float = 5) -> None:
        self.font(size, bold)
        self.multi_cell(0, gap, self.clean(text), new_x="LMARGIN", new_y="NEXT")

    def section(self, title: str) -> None:
        self.ln(3)
        self.font(11, bold=True)
        self.cell(0, 6, self.clean(title.upper()), new_x="LMARGIN", new_y="NEXT")
        y = self.get_y()
        self.set_draw_color(160, 160, 160)
        self.line(self.l_margin, y, self.w - self.r_margin, y)
        self.ln(1.5)

    def bullet(self, text: str) -> None:
        self.font(10)
        self.set_x(self.l_margin + 1)
        self.cell(4, 5, self.clean("\u2022"))
        self.multi_cell(0, 5, self.clean(text), new_x="LMARGIN", new_y="NEXT")
        self.ln(0.6)


def _font_files() -> tuple[Path | None, Path | None]:
    configured = get_settings().pdf_font
    if configured:
        if not configured.exists():
            raise DomainError(f"JOBCOPILOT_PDF_FONT {configured} does not exist")
        return configured, configured
    for regular, bold in _FONT_CANDIDATES:
        if regular.exists():
            return regular, bold if bold.exists() else regular
    return None, None


@dataclass
class _Context:
    app: Application
    job: Job
    company: Company
    docs: dict
    answers: list[AnswerBankEntry]

    @property
    def contact(self) -> dict[str, str]:
        by_key = {a.question_key: a.answer.strip() for a in self.answers}
        return {k: by_key[k] for k in CONTACT_FIELDS if by_key.get(k)}

    def claims(self, kind: DocumentKind) -> list[str]:
        doc = self.docs.get(kind)
        return [c.body for c in doc.claims] if doc else []


def _context(session: Session, app: Application) -> _Context:
    docs = approved_documents(session, app)
    if not docs:
        raise DomainError("nothing approved yet: approve the application's documents first")
    job = session.get(Job, app.job_id)
    answers = session.scalars(
        select(AnswerBankEntry).where(AnswerBankEntry.user_id == app.user_id).order_by(AnswerBankEntry.question_key)
    ).all()
    return _Context(app, job, session.get(Company, job.company_id), docs, list(answers))


def _output_dir(application_id: uuid.UUID) -> Path:
    path = Path(get_settings().file_root) / "rendered" / str(application_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def render_resume(session: Session, app: Application) -> Path:
    ctx = _context(session, app)
    bullets = ctx.claims(DocumentKind.RESUME_BULLETS)
    if not bullets:
        raise DomainError("approve resume bullets before rendering a resume")
    contact = ctx.contact
    facts = list_facts(session, app.user_id, [FactStatus.VERIFIED])

    template = get_settings().latex_template
    if template:
        version = ctx.docs[DocumentKind.RESUME_BULLETS].doc_version
        path = render_latex_resume(ctx, facts, bullets, template, version)
        ctx.docs[DocumentKind.RESUME_BULLETS].rendered_path = str(path)
        session.flush()
        return path

    pdf = _Doc(f"{contact.get('full_name', 'Resume')} - {ctx.job.title}", contact.get("full_name"))
    if "full_name" in contact:
        pdf.heading(contact["full_name"])
    details = [contact[k] for k in ("email", "phone", "location", "linkedin", "github", "website") if k in contact]
    if details:
        pdf.line_text("  |  ".join(details), size=9.5)

    if summary := ctx.claims(DocumentKind.SUMMARY):
        pdf.section("Summary")
        pdf.line_text(" ".join(summary))

    pdf.section("Highlights")
    for claim in bullets:
        pdf.bullet(claim)

    roles = [f.statement for f in facts if f.kind == FactKind.ROLE]
    if roles:
        pdf.section("Experience")
        for role in roles:
            pdf.bullet(role)

    skills: dict[str, None] = {}
    for fact in facts:
        if fact.kind == FactKind.SKILL:
            for skill in fact.details.get("skills") or []:
                if isinstance(skill, str) and skill.strip():
                    skills.setdefault(display_term(skill.strip()), None)
    if skills:
        pdf.section("Skills")
        pdf.line_text(", ".join(skills))

    for kind, title in ((FactKind.EDUCATION, "Education"), (FactKind.CERTIFICATION, "Certifications")):
        statements = [f.statement for f in facts if f.kind == kind]
        if statements:
            pdf.section(title)
            for statement in statements:
                pdf.bullet(statement)

    version = ctx.docs[DocumentKind.RESUME_BULLETS].doc_version
    path = _output_dir(app.id) / f"resume-v{version}.pdf"
    pdf.output(str(path))
    ctx.docs[DocumentKind.RESUME_BULLETS].rendered_path = str(path)
    session.flush()
    return path


def render_latex_resume(
    ctx: _Context, facts: list, bullets: list[str], template: Path, version: int
) -> Path:
    """Render an approved resume through a user-owned Jinja-compatible LaTeX template.

    Scalar values are escaped before entering the template. Section values are already complete
    LaTeX snippets, allowing templates to use simple placeholders without exposing database data
    or requiring template-side loops.
    """
    contact = ctx.contact
    roles = [f.statement for f in facts if f.kind == FactKind.ROLE]
    skills: dict[str, None] = {}
    for fact in facts:
        if fact.kind == FactKind.SKILL:
            for skill in fact.details.get("skills") or []:
                if isinstance(skill, str) and skill.strip():
                    skills.setdefault(display_term(skill.strip()), None)
    education = [f.statement for f in facts if f.kind == FactKind.EDUCATION]
    certifications = [f.statement for f in facts if f.kind == FactKind.CERTIFICATION]

    def items(values: list[str]) -> str:
        return "\n".join(r"\item " + latex_escape(value) for value in values)

    summary = ctx.claims(DocumentKind.SUMMARY)
    context = {
        "full_name": latex_escape(contact.get("full_name")),
        "email": latex_escape(contact.get("email")),
        "phone": latex_escape(contact.get("phone")),
        "location": latex_escape(contact.get("location")),
        "linkedin": latex_escape(contact.get("linkedin")),
        "github": latex_escape(contact.get("github")),
        "website": latex_escape(contact.get("website")),
        "contact_line": latex_escape("  |  ".join(contact[k] for k in (
            "email", "phone", "location", "linkedin", "github", "website"
        ) if k in contact)),
        "job_title": latex_escape(ctx.job.title),
        "company": latex_escape(ctx.company.name),
        "summary": latex_escape(" ".join(summary)),
        "highlights": items(bullets),
        "experience": items(roles),
        "skills": latex_escape(", ".join(skills)),
        "education": items(education),
        "certifications": items(certifications),
    }
    return render_and_compile(
        template,
        _output_dir(ctx.app.id),
        f"resume-v{version}",
        context,
        get_settings().latex_engine,
    )


def render_answers(session: Session, app: Application) -> Path:
    ctx = _context(session, app)
    pdf = _Doc(f"Answers - {ctx.job.title} at {ctx.company.name}", ctx.contact.get("full_name"))
    pdf.heading(f"{ctx.job.title} at {ctx.company.name}", size=15)
    pdf.line_text("Application answers sheet. Copy these into the form; check every answer before submitting.", 9)

    if ctx.contact:
        pdf.section("Contact details")
        for key, value in ctx.contact.items():
            pdf.line_text(f"{CONTACT_FIELDS[key]}: {value}")

    if screening := ctx.claims(DocumentKind.SCREENING_ANSWERS):
        pdf.section("Screening answers")
        for answer in screening:
            pdf.bullet(answer)

    other = [a for a in ctx.answers if a.question_key not in CONTACT_FIELDS]
    if other:
        pdf.section("Saved answers")
        for entry in other:
            pdf.line_text(entry.question, bold=True)
            note = f"   (last confirmed {entry.last_confirmed_at:%d %b %Y}: confirm it is still true)"
            pdf.line_text(entry.answer + (note if is_stale(entry) else ""))
            pdf.ln(1)

    if letter := ctx.claims(DocumentKind.COVER_LETTER):
        pdf.section("Cover letter")
        pdf.line_text(" ".join(letter))

    path = _output_dir(app.id) / "answers.pdf"
    pdf.output(str(path))
    return path
