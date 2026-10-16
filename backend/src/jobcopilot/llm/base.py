"""A thin provider interface (design 9.1: no framework until one earns its place)."""

import hashlib
import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

import httpx
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from jobcopilot.audit.models import LLMCall
from jobcopilot.audit.service import llm_spend_since
from jobcopilot.config import get_settings
from jobcopilot.db import utcnow
from jobcopilot.errors import DomainError

# Prefix of the error call_structured returns when the provider could not be reached at all (as
# opposed to answering badly). Callers retry the former later; the latter counts as a failed attempt.
PROVIDER_ERROR = "provider error"


@dataclass
class LLMResponse:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_inr: float = 0.0


class LLMProvider(Protocol):
    name: str
    model: str
    # False for free hosted tiers whose terms may allow training on inputs (design 10.3).
    allows_personal_data: bool
    # True if calls cost money and count against the monthly cap.
    billable: bool

    def complete_json(self, system: str, prompt: str, schema: dict) -> LLMResponse: ...


class OllamaProvider:
    name = "ollama"
    allows_personal_data = True  # runs on this machine
    billable = False

    def __init__(self, url: str | None = None, model: str | None = None, client: httpx.Client | None = None):
        settings = get_settings()
        self.url = (url or settings.ollama_url).rstrip("/")
        self.model = model or settings.ollama_model
        self.client = client or httpx.Client(timeout=180)

    def complete_json(self, system: str, prompt: str, schema: dict) -> LLMResponse:
        response = self.client.post(
            f"{self.url}/api/chat",
            json={
                "model": self.model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                "format": schema,
                "stream": False,
                "options": {"temperature": 0.2},
            },
        )
        response.raise_for_status()
        body = response.json()
        return LLMResponse(body["message"]["content"], body.get("prompt_eval_count", 0), body.get("eval_count", 0))


class GeminiProvider:
    """Google Gemini provider using the official google-genai SDK."""

    name = "gemini"

    def __init__(self, client=None):
        settings = get_settings()
        if not settings.gemini_api_key:
            raise DomainError("set JOBCOPILOT_GEMINI_API_KEY first")
        self.model = settings.gemini_model
        self.allows_personal_data = settings.gemini_allows_personal_data
        self.inr_per_1k = settings.gemini_inr_per_1k_tokens
        self.billable = self.inr_per_1k > 0
        if client is None:
            from google import genai

            client = genai.Client(api_key=settings.gemini_api_key)
        self.client = client

    def complete_json(self, system: str, prompt: str, schema: dict) -> LLMResponse:
        response = self.client.models.generate_content(
            model=self.model,
            contents=prompt,
            config={
                "system_instruction": system,
                "temperature": 0.2,
                "response_mime_type": "application/json",
                "response_json_schema": schema,
            },
        )
        usage = response.usage_metadata
        input_tokens = getattr(usage, "prompt_token_count", 0) if usage else 0
        output_tokens = getattr(usage, "candidates_token_count", 0) if usage else 0
        return LLMResponse(
            response.text,
            input_tokens,
            output_tokens,
            cost_inr=(input_tokens + output_tokens) / 1000 * self.inr_per_1k,
        )


class OpenAICompatibleProvider:
    """Any chat-completions API: Groq, Gemini's OpenAI endpoint, Azure OpenAI, a local vLLM, ..."""

    name = "hosted"

    def __init__(self, client: httpx.Client | None = None):
        settings = get_settings()
        if not settings.hosted_llm_api_key or not settings.hosted_llm_model:
            raise DomainError("set JOBCOPILOT_HOSTED_LLM_API_KEY and JOBCOPILOT_HOSTED_LLM_MODEL first")
        self.url = settings.hosted_llm_url.rstrip("/")
        self.model = settings.hosted_llm_model
        self.allows_personal_data = settings.hosted_llm_allows_personal_data
        self.inr_per_1k = settings.hosted_llm_inr_per_1k_tokens
        self.billable = self.inr_per_1k > 0
        self.client = client or httpx.Client(
            timeout=120, headers={"Authorization": f"Bearer {settings.hosted_llm_api_key}"}
        )

    def complete_json(self, system: str, prompt: str, schema: dict) -> LLMResponse:
        # json_object mode is the widely supported subset; the schema itself travels in the prompt.
        response = self.client.post(
            f"{self.url}/chat/completions",
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": f"{system}\n\nJSON schema:\n{json.dumps(schema)}"},
                    {"role": "user", "content": prompt},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.2,
            },
        )
        response.raise_for_status()
        body = response.json()
        usage = body.get("usage") or {}
        tokens_in, tokens_out = usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)
        return LLMResponse(
            body["choices"][0]["message"]["content"],
            tokens_in,
            tokens_out,
            cost_inr=(tokens_in + tokens_out) / 1000 * self.inr_per_1k,
        )


def get_provider(kind: str) -> LLMProvider:
    """Select an optional vendor by its configured name."""
    if kind == "ollama":
        return OllamaProvider()
    if kind == "gemini":
        return GeminiProvider()
    if kind == "hosted":
        return OpenAICompatibleProvider()
    raise DomainError(f"unknown LLM provider {kind!r}")


class BudgetExceeded(DomainError):
    pass


def _month_start() -> datetime:
    return utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def call_structured[T: BaseModel](
    session: Session,
    provider: LLMProvider,
    output_model: type[T],
    *,
    purpose: str,
    prompt_version: str,
    system: str,
    prompt: str,
    contains_personal_data: bool,
    user_id: uuid.UUID | None = None,
    application_id: uuid.UUID | None = None,
) -> tuple[T | None, str | None]:
    """Call the model for schema-shaped output and log the call. Returns (parsed, error)."""
    if contains_personal_data and not provider.allows_personal_data:
        raise DomainError(f"provider {provider.name} must not receive personal data")
    cap = get_settings().llm_monthly_cap_inr
    if provider.billable and llm_spend_since(session, _month_start()) >= cap:
        raise BudgetExceeded(f"monthly LLM cap of ₹{cap:g} reached")

    started = time.perf_counter()
    parsed: T | None = None
    error: str | None = None
    response = LLMResponse("")
    try:
        response = provider.complete_json(system, prompt, output_model.model_json_schema())
        parsed = output_model.model_validate_json(response.text)
        outcome = "ok"
    except ValidationError as exc:
        outcome, error = "invalid_output", f"output did not match schema: {exc.error_count()} errors"
    except httpx.HTTPError as exc:
        outcome, error = "error", f"{PROVIDER_ERROR}: {exc!r}"[:500]

    session.add(
        LLMCall(
            user_id=user_id,
            application_id=application_id,
            purpose=purpose,
            provider=provider.name,
            model=provider.model,
            prompt_version=prompt_version,
            # Only a hash: the prompt contains the resume and must not be retained in telemetry.
            prompt_hash=hashlib.sha256((system + "\n" + prompt).encode()).hexdigest(),
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            cost_inr=response.cost_inr,
            latency_ms=int((time.perf_counter() - started) * 1000),
            outcome=outcome,
        )
    )
    session.flush()
    return parsed, error
