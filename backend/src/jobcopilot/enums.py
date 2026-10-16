from enum import StrEnum


def check_in(column: str, enum: type[StrEnum]) -> str:
    """SQL for a text column constrained to an enum's values (new states are added by migration)."""
    values = ", ".join(f"'{v.value}'" for v in enum)
    return f"{column} IN ({values})"


class FactStatus(StrEnum):
    PROPOSED = "proposed"
    VERIFIED = "verified"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"


class FactKind(StrEnum):
    SKILL = "skill"
    EXPERIENCE = "experience"
    ROLE = "role"
    PROJECT = "project"
    ACHIEVEMENT = "achievement"
    EDUCATION = "education"
    CERTIFICATION = "certification"
    OTHER = "other"


class Importance(StrEnum):
    MUST = "must"
    PREFERRED = "preferred"


class Coverage(StrEnum):
    FULL = "full"
    PARTIAL = "partial"
    GAP = "gap"


class WorkMode(StrEnum):
    ONSITE = "onsite"
    HYBRID = "hybrid"
    REMOTE = "remote"
    UNKNOWN = "unknown"


class Freshness(StrEnum):
    FRESH = "fresh"
    STALE = "stale"
    CLOSED = "closed"


class DocumentKind(StrEnum):
    RESUME_BULLETS = "resume_bullets"
    SUMMARY = "summary"
    SCREENING_ANSWERS = "screening_answers"
    COVER_LETTER = "cover_letter"


class DocumentState(StrEnum):
    DRAFT = "draft"
    VALIDATED = "validated"
    APPROVED = "approved"
    REJECTED = "rejected"


class EvidenceKind(StrEnum):
    CONFIRMATION_PAGE = "confirmation_page"
    CONFIRMATION_EMAIL = "confirmation_email"
    REJECTION_EMAIL = "rejection_email"
    ASSESSMENT_EMAIL = "assessment_email"
    INTERVIEW_EMAIL = "interview_email"
    OFFER_EMAIL = "offer_email"
    SUBMISSION_ATTEMPT = "submission_attempt"
    MANUAL_NOTE = "manual_note"


class Actor(StrEnum):
    USER = "user"
    SYSTEM = "system"
    EXTENSION = "extension"
    EMAIL = "email"


class AppStatus(StrEnum):
    DISCOVERED = "discovered"
    REJECTED_BY_RULES = "rejected_by_rules"
    SHORTLISTED = "shortlisted"
    PREPARED = "prepared"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    SUBMISSION_IN_PROGRESS = "submission_in_progress"
    SUBMITTED_UNCONFIRMED = "submitted_unconfirmed"
    SUBMISSION_CONFIRMED = "submission_confirmed"
    REJECTED = "rejected"
    ASSESSMENT = "assessment"
    INTERVIEW = "interview"
    OFFER = "offer"
    WITHDRAWN = "withdrawn"
    FAILED = "failed"
    NEEDS_MANUAL_INTERVENTION = "needs_manual_intervention"


class MessageClass(StrEnum):
    CONFIRMATION = "confirmation"
    REJECTION = "rejection"
    INTERVIEW = "interview"
    ASSESSMENT = "assessment"
    OFFER = "offer"
    JOB_ALERT = "job_alert"
    OTHER = "other"
