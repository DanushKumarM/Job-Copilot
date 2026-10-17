"""Request and response bodies. TypeScript types for the console and extension are generated from
the OpenAPI schema these produce."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from jobcopilot.enums import AppStatus, DocumentKind, EvidenceKind, FactKind, MessageClass, WorkMode
from jobcopilot.generation.validator import ClaimDraft


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(RegisterIn):
    pass


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str


class AuthOut(BaseModel):
    user: UserOut


class FactOut(ORM):
    id: uuid.UUID
    kind: str
    statement: str
    details: dict
    status: str
    superseded_by: uuid.UUID | None
    verified_at: datetime | None


class FactIn(BaseModel):
    kind: FactKind
    statement: str = Field(min_length=3, max_length=1000)
    details: dict = {}


class FactRevision(BaseModel):
    statement: str = Field(min_length=3, max_length=1000)
    details: dict | None = None


class ResumeIn(BaseModel):
    text: str = Field(min_length=20, max_length=100_000)
    file_name: str = "resume.txt"


class AnswerIn(BaseModel):
    question: str
    answer: str


class AnswerOut(ORM):
    question_key: str
    question: str
    answer: str
    last_confirmed_at: datetime
    stale: bool = False


class PastedJobIn(BaseModel):
    title: str = Field(min_length=2)
    company: str = Field(min_length=1)
    description: str = Field(min_length=20)
    url: str | None = None
    location: str | None = None
    work_mode: WorkMode = WorkMode.UNKNOWN
    salary_min: int | None = None
    salary_max: int | None = None


class SourceIn(BaseModel):
    kind: str = Field(pattern="^(greenhouse|lever)$")
    # greenhouse: {"board_token": "acme", "company": "Acme"}; lever: {"site": "acme", "company": "Acme"}
    config: dict


class SourceOut(ORM):
    id: uuid.UUID
    kind: str
    config: dict
    access_basis: str
    health: str
    last_polled_at: datetime | None


class RequirementOut(ORM):
    id: uuid.UUID
    statement: str
    importance: str
    terms: list[str]
    min_years: float | None


class EvaluationOut(ORM):
    id: uuid.UUID
    score: int
    hard_filter_pass: bool
    hard_filter_reasons: list[str]
    breakdown: dict
    scorer_version: str
    created_at: datetime


class JobSummary(BaseModel):
    id: uuid.UUID
    title: str
    company: str
    location: str | None
    work_mode: str
    freshness: str
    score: int | None
    application_id: uuid.UUID | None
    application_status: str | None


class PostingOut(ORM):
    id: uuid.UUID
    source_id: uuid.UUID
    url: str | None
    merge_confidence: float
    fetched_at: datetime


class MatchOut(ORM):
    """Why a requirement is covered: the supporting fact, or a gap (fact_id null)."""

    requirement_id: uuid.UUID
    fact_id: uuid.UUID | None
    coverage: str
    rationale: str | None


class JobDetail(JobSummary):
    description: str
    requirements: list[RequirementOut]
    evaluation: EvaluationOut | None
    matches: list[MatchOut]
    postings: list[PostingOut]
    extractor_version: str | None = None


class ClaimOut(BaseModel):
    body: str
    fact_ids: list[uuid.UUID]


class DocumentOut(BaseModel):
    id: uuid.UUID
    kind: str
    doc_version: int
    state: str
    model: str | None
    claims: list[ClaimOut]


class DocumentIn(BaseModel):
    claims: list[ClaimDraft] = Field(min_length=1, max_length=40)


class EventOut(ORM):
    from_status: str | None
    to_status: str
    actor: str
    evidence_id: uuid.UUID | None
    note: str | None
    created_at: datetime


class ApplicationOut(ORM):
    id: uuid.UUID
    job_id: uuid.UUID
    status: str
    lock_version: int
    submitted_at: datetime | None
    confirmed_at: datetime | None
    updated_at: datetime


class ApplicationSummary(ApplicationOut):
    job_title: str
    company: str
    score: int | None
    job_url: str | None


class EvidenceOut(ORM):
    id: uuid.UUID
    kind: str
    external_ref: str
    extracted: dict
    confidence: float
    created_at: datetime


class ApplicationDetail(ApplicationSummary):
    documents: list[DocumentOut]
    history: list[EventOut]
    evidence: list[EvidenceOut]
    # Statuses the user may move to by hand from here (the console shows these as actions).
    allowed_targets: list[str]


class ExtensionLookup(BaseModel):
    """What the extension needs on an application page: which application it is, and its state."""

    application: ApplicationSummary
    adapter: str | None  # "greenhouse" | "lever": the extension's form adapter for this site
    packet_ready: bool


class StatusOut(BaseModel):
    llm_provider: str
    llm_model: str
    requirement_extractor: str
    extraction_provider: str
    gmail_connected: bool
    contact_fields: dict[str, str]


class TransitionIn(BaseModel):
    target: AppStatus
    lock_version: int
    note: str | None = None


class ApproveIn(BaseModel):
    lock_version: int


class EvidenceIn(BaseModel):
    kind: EvidenceKind
    # Gmail message ID, or "page:<sha256 of the confirmation page text>" from the extension.
    external_ref: str = Field(min_length=3, max_length=500)
    extracted: dict = {}
    confidence: float = Field(default=1.0, ge=0, le=1)


class EvidenceResult(BaseModel):
    action: str
    application: ApplicationOut


class PacketOut(BaseModel):
    application_id: uuid.UUID
    job_title: str
    company: str
    documents: dict[str, list[str]]
    answers: dict[str, str]
    stale_answers: list[str]
    questions: dict[str, str]


class GenerateIn(BaseModel):
    kind: DocumentKind = DocumentKind.RESUME_BULLETS


class InboxStatus(BaseModel):
    gmail_connected: bool
    last_synced_at: datetime | None
    unresolved: int


class InboundMessageOut(ORM):
    id: uuid.UUID
    classification: str
    confidence: float
    application_id: uuid.UUID | None
    extracted: dict
    processed_at: datetime
    resolved_at: datetime | None


class AssignIn(BaseModel):
    application_id: uuid.UUID
    # Correct the classification if the classifier got it wrong.
    classification: MessageClass | None = None


class ImportIn(BaseModel):
    """An email about an application made outside job-copilot (e.g. Naukri NEO, LinkedIn Easy Apply)."""

    company: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)
    location: str | None = None
    classification: MessageClass | None = None


class PrepareQuestionsIn(BaseModel):
    questions: list[str] = Field(min_length=1, max_length=15)


class PreparedAnswer(BaseModel):
    question: str
    answer: str


class PrepareQuestionsOut(BaseModel):
    answers: list[PreparedAnswer]
