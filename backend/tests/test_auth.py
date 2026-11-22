import uuid
from unittest.mock import MagicMock

from fastapi import HTTPException

from jobcopilot import auth
from jobcopilot.api.deps import current_user
from jobcopilot.auth import hash_password, verify_password
from jobcopilot.profile.models import User


def test_password_hash_round_trip():
    encoded = hash_password("correct horse battery staple")

    assert encoded.startswith("pbkdf2_sha256$")
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong password", encoded)


def test_password_verification_rejects_invalid_hashes():
    assert not verify_password("password", None)
    assert not verify_password("password", "not-a-password-hash")


def test_current_user_accepts_bearer_session_token(monkeypatch):
    from jobcopilot.config import get_settings

    monkeypatch.setenv("JOBCOPILOT_API_TOKEN", "")
    get_settings.cache_clear()
    session = MagicMock()
    user = User(id=uuid.uuid4(), email="mobile@example.com", preferences={})

    monkeypatch.setattr(auth, "user_for_session", lambda s, token: user if token == "valid-mobile-token" else None)

    # Valid bearer session token
    resolved = current_user(session, authorization="Bearer valid-mobile-token")
    assert resolved == user

    # Invalid bearer session token raises 401
    try:
        current_user(session, authorization="Bearer invalid-token")
        assert False, "Should have raised HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 401
    finally:
        get_settings.cache_clear()


def test_current_user_preserves_static_api_token(monkeypatch):
    from jobcopilot.config import get_settings

    monkeypatch.setenv("JOBCOPILOT_API_TOKEN", "super-secret-admin")
    monkeypatch.setenv("JOBCOPILOT_OWNER_EMAIL", "owner@example.com")
    get_settings.cache_clear()
    session = MagicMock()
    owner = User(id=uuid.uuid4(), email="owner@example.com", preferences={})

    monkeypatch.setattr("jobcopilot.api.deps.get_or_create_user", lambda s, email: owner)

    resolved = current_user(session, authorization="Bearer super-secret-admin")
    assert resolved == owner
    get_settings.cache_clear()


def test_auth_routes_mobile_bearer(monkeypatch):
    from fastapi import Response
    from jobcopilot.api import schemas as s
    from jobcopilot.api.routes import login, logout, me, register

    session = MagicMock()
    user = User(id=uuid.uuid4(), email="test@example.com", preferences={}, password_hash="dummy")

    session.scalar.return_value = None  # for register: email doesn't exist yet

    monkeypatch.setattr(auth, "create_session", lambda s, u: "generated-session-token-xyz")
    revoked = []
    monkeypatch.setattr(auth, "revoke_session", lambda s, token: revoked.append(token))

    # Test register returns session_token
    res_reg = Response()
    reg_out = register(s.RegisterIn(email="test@example.com", password="password123"), res_reg, session)
    assert reg_out["user"].email == "test@example.com"
    assert reg_out["session_token"] == "generated-session-token-xyz"

    # Test login returns session_token
    session.scalar.return_value = user
    monkeypatch.setattr(auth, "verify_password", lambda p, h: True)
    res_login = Response()
    login_out = login(s.LoginIn(email="test@example.com", password="password123"), res_login, session)
    assert login_out["user"].email == "test@example.com"
    assert login_out["session_token"] == "generated-session-token-xyz"

    # Test me with Bearer session token
    me_out = me(user=user, authorization="Bearer generated-session-token-xyz")
    assert me_out["user"].email == "test@example.com"
    assert me_out["session_token"] == "generated-session-token-xyz"

    # Test logout with Bearer session token
    logout(Response(), session, authorization="Bearer generated-session-token-xyz")
    assert "generated-session-token-xyz" in revoked


