"""Imports every module's models so metadata (and Alembic) sees the whole schema."""

from jobcopilot.audit.models import AuditLog, LLMCall
from jobcopilot.db import Base
from jobcopilot.generation.models import Claim, ClaimEvidence, GeneratedDocument
from jobcopilot.ingestion.models import Company, Job, JobPosting, JobRequirement, Source
from jobcopilot.lifecycle.models import Application, ApplicationEvent, Evidence, InboundMessage
from jobcopilot.matching.models import MatchEvaluation, RequirementMatch
from jobcopilot.profile.models import AnswerBankEntry, AuthSession, ProfileFact, SourceDocument, User

__all__ = [
    "AnswerBankEntry",
    "AuthSession",
    "Application",
    "ApplicationEvent",
    "AuditLog",
    "Base",
    "Claim",
    "ClaimEvidence",
    "Company",
    "Evidence",
    "GeneratedDocument",
    "InboundMessage",
    "Job",
    "JobPosting",
    "JobRequirement",
    "LLMCall",
    "MatchEvaluation",
    "ProfileFact",
    "RequirementMatch",
    "Source",
    "SourceDocument",
    "User",
]
