import hmac
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from jobcopilot import auth
from jobcopilot.config import get_settings
from jobcopilot.db import get_session
from jobcopilot.llm.base import LLMProvider, get_provider
from jobcopilot.profile.models import User
from jobcopilot.profile.service import get_or_create_user

SessionDep = Annotated[Session, Depends(get_session)]


def current_user(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
    session_cookie: Annotated[str | None, Cookie(alias=auth.SESSION_COOKIE)] = None,
) -> User:
    settings = get_settings()
    scheme, _, token = (authorization or "").partition(" ")
    if settings.api_token and scheme.lower() == "bearer" and hmac.compare_digest(
        token.encode(), settings.api_token.encode()
    ):
        return get_or_create_user(session, settings.owner_email)
    user = auth.user_for_session(session, session_cookie)
    if user:
        return user
    if not settings.api_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sign in required")
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials", headers={"WWW-Authenticate": "Bearer"})


UserDep = Annotated[User, Depends(current_user)]


def llm_provider() -> LLMProvider:
    return get_provider(get_settings().llm_provider)


LLMDep = Annotated[LLMProvider, Depends(llm_provider)]
