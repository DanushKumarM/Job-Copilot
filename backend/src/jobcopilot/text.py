"""Deterministic text helpers shared by ingestion, matching and validation."""

import hashlib
import re
import unicodedata

# Canonical term -> spellings that should count as the same thing. Deliberately small and editable;
# the LLM extractor can add terms per job, but grounding checks only need a shared vocabulary.
SKILL_ALIASES: dict[str, tuple[str, ...]] = {
    "python": ("python",),
    "java": ("java",),
    "javascript": ("javascript", "js"),
    "typescript": ("typescript", "ts"),
    "go": ("golang", "go lang"),
    "rust": ("rust",),
    "c++": ("c++", "cpp"),
    "c#": ("c#", "csharp", ".net"),
    "kotlin": ("kotlin",),
    "ruby": ("ruby",),
    "php": ("php",),
    "scala": ("scala",),
    "sql": ("sql",),
    "postgresql": ("postgresql", "postgres", "psql"),
    "mysql": ("mysql",),
    "mongodb": ("mongodb", "mongo"),
    "redis": ("redis",),
    "elasticsearch": ("elasticsearch", "elastic search", "opensearch"),
    "kafka": ("kafka",),
    "rabbitmq": ("rabbitmq",),
    "spark": ("spark", "pyspark"),
    "airflow": ("airflow",),
    "django": ("django",),
    "flask": ("flask",),
    "fastapi": ("fastapi",),
    "spring": ("spring", "spring boot", "springboot"),
    "node.js": ("node.js", "nodejs", "node"),
    "react": ("react", "react.js", "reactjs"),
    "angular": ("angular",),
    "vue": ("vue", "vue.js"),
    "graphql": ("graphql",),
    "grpc": ("grpc",),
    "rest": ("rest api", "restful", "rest apis"),
    "microservices": ("microservices", "microservice"),
    "docker": ("docker",),
    "kubernetes": ("kubernetes", "k8s"),
    "terraform": ("terraform",),
    "aws": ("aws", "amazon web services"),
    "gcp": ("gcp", "google cloud"),
    "azure": ("azure",),
    "linux": ("linux",),
    "git": ("git",),
    "ci/cd": ("ci/cd", "cicd", "continuous integration"),
    "machine learning": ("machine learning", "ml"),
    "deep learning": ("deep learning",),
    "pytorch": ("pytorch",),
    "tensorflow": ("tensorflow",),
    "llm": ("llm", "llms", "large language model"),
    "nlp": ("nlp", "natural language processing"),
    "data structures": ("data structures",),
    "system design": ("system design",),
}

_ALIAS_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # Word-ish boundaries that tolerate symbols like "c++" and ".net".
    (canonical, re.compile(r"(?<![\w+#.])" + re.escape(alias) + r"(?![\w+#])", re.IGNORECASE))
    for canonical, aliases in SKILL_ALIASES.items()
    for alias in sorted(aliases, key=len, reverse=True)
]

_COMPANY_SUFFIXES = re.compile(
    r"\b(private limited|pvt\.? ltd\.?|pvt|ltd\.?|limited|inc\.?|llc|llp|corp\.?|corporation|"
    r"technologies|technology|labs|software|solutions|india|co\.?)\b",
    re.IGNORECASE,
)
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def find_terms(text: str, extra_terms: frozenset[str] = frozenset()) -> set[str]:
    """Canonical skill terms mentioned in text."""
    found = {canonical for canonical, pattern in _ALIAS_PATTERNS if pattern.search(text)}
    lowered = text.lower()
    for term in extra_terms:
        if re.search(r"(?<![\w+#.])" + re.escape(term) + r"(?![\w+#])", lowered):
            found.add(term)
    return found


def canonical_term(term: str) -> str:
    lowered = term.strip().lower()
    for canonical, aliases in SKILL_ALIASES.items():
        if lowered == canonical or lowered in aliases:
            return canonical
    return lowered


def find_numbers(text: str) -> set[str]:
    return {n.replace(",", "") for n in _NUMBER.findall(text)}


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s+#]", " ", text.lower())).strip()


def normalize_company(name: str) -> str:
    folded = _fold(_COMPANY_SUFFIXES.sub(" ", name))
    return folded or _fold(name)


_SENIORITY = {"sr": "senior", "jr": "junior", "snr": "senior", "engg": "engineer", "dev": "developer"}


def normalize_title(title: str) -> str:
    words = [_SENIORITY.get(w, w) for w in _fold(title).split()]
    return " ".join(words)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# How canonical (lower-case) terms are written for people, where plain capitalisation is wrong.
_DISPLAY = {
    "aws": "AWS",
    "gcp": "GCP",
    "sql": "SQL",
    "rest": "REST APIs",
    "ci/cd": "CI/CD",
    "nlp": "NLP",
    "llm": "LLMs",
    "grpc": "gRPC",
    "graphql": "GraphQL",
    "mysql": "MySQL",
    "postgresql": "PostgreSQL",
    "mongodb": "MongoDB",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "node.js": "Node.js",
    "fastapi": "FastAPI",
    "pytorch": "PyTorch",
    "tensorflow": "TensorFlow",
    "rabbitmq": "RabbitMQ",
    "c++": "C++",
    "c#": "C#",
    "php": "PHP",
    "elasticsearch": "Elasticsearch",
    "go": "Go",
}


def display_term(term: str) -> str:
    """ "postgresql" -> "PostgreSQL". Terms the user typed with their own capitals are left alone."""
    if term != term.lower():
        return term
    return _DISPLAY.get(term) or " ".join(w[:1].upper() + w[1:] for w in term.split())
