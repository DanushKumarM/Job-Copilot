"""Password authentication and opaque browser sessions."""

import hashlib
import hmac
import secrets
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from jobcopilot.db import utcnow
from jobcopilot.errors import DomainError
from jobcopilot.profile.models import AuthSession, User

SESSION_COOKIE = "jobcopilot_session"
SESSION_DAYS = 30
PBKDF2_ITERATIONS = 600_000


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    if len(password) < 8:
        raise DomainError("password must be at least 8 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algorithm, iterations, salt, expected = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), expected)


def create_session(session: Session, user: User) -> str:
    raw = secrets.token_urlsafe(32)
    record = AuthSession(
        user_id=user.id,
        token_hash=hashlib.sha256(raw.encode()).hexdigest(),
        expires_at=utcnow() + timedelta(days=SESSION_DAYS),
    )
    session.add(record)
    session.flush()
    return raw


def user_for_session(session: Session, raw_token: str | None) -> User | None:
    if not raw_token:
        return None
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    record = session.scalar(
        select(AuthSession).where(
            AuthSession.token_hash == token_hash,
            AuthSession.expires_at > utcnow(),
        )
    )
    return session.get(User, record.user_id) if record else None


def revoke_session(session: Session, raw_token: str | None) -> None:
    if not raw_token:
        return
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    session.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash))
