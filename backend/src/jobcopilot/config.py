from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="JOBCOPILOT_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres@localhost:5433/jobcopilot"
    file_root: Path = Path("../data/files")

    # Single-user MVP: the owner's account, and the bearer token the console and extension present.
    owner_email: str = "me@example.com"
    api_token: str = ""
    auth_cookie_secure: bool = False

    # Gmail (read-only). The OAuth client file comes from Google Cloud Console ("Desktop app" client);
    # the resulting refresh token is stored in the OS keychain, never in files.
    gmail_client_secret_file: Path | None = None
    gmail_initial_lookback_days: int = 30

    # Which provider writes application content: "ollama", "gemini", or "hosted".
    llm_provider: str = "ollama"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b"
    # Hosted providers bill per call; a cap of 0 means "local models only".
    llm_monthly_cap_inr: float = 0.0

    # Any OpenAI-compatible chat API (Groq, Gemini's OpenAI endpoint, Azure OpenAI, ...).
    hosted_llm_url: str = "https://api.groq.com/openai/v1"
    hosted_llm_api_key: str = ""
    hosted_llm_model: str = ""
    # Free tiers may train on inputs (design 10.3): leave False unless the provider's terms say otherwise.
    hosted_llm_allows_personal_data: bool = False
    hosted_llm_inr_per_1k_tokens: float = 0.0
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    gemini_allows_personal_data: bool = False
    gemini_inr_per_1k_tokens: float = 0.0

    # Requirement extraction: "rules" (offline, instant) or "llm" (the worker refines rule output with a
    # model). Job descriptions are public, so a free hosted tier is acceptable here.
    requirement_extractor: str = "rules"
    extraction_provider: str = "ollama"

    # TrueType font for rendered PDFs. Empty: look for Arial (Windows) or DejaVu Sans (Linux).
    pdf_font: Path | None = None
    # Optional user-owned LaTeX resume template. When set, it replaces the fpdf2 resume renderer.
    latex_template: Path | None = None
    latex_engine: str = "pdflatex"
    # The built web console (console/dist); served at / when it exists.
    console_dir: Path = Path("../console/dist")


@lru_cache
def get_settings() -> Settings:
    return Settings()
