from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .config import (
    get_google_client_id,
    get_session_cookie_name,
    get_session_cookie_secure,
    get_session_max_age_seconds,
)
from .db import (
    User,
    clear_user_data,
    create_user_session,
    delete_all_user_sessions,
    delete_user_session,
    get_db_session,
    get_user_by_session_token,
    upsert_google_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])
DbSession = Annotated[Session, Depends(get_db_session)]


class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=1)


class AuthUserResponse(BaseModel):
    id: str
    email: str
    name: str
    picture_url: str | None
    plan: str


def serialize_auth_user(user: User) -> AuthUserResponse:
    return AuthUserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        picture_url=user.picture_url,
        plan=user.plan,
    )


def _set_session_cookie(response: Response, raw_token: str) -> None:
    max_age = get_session_max_age_seconds()
    response.set_cookie(
        key=get_session_cookie_name(),
        value=raw_token,
        max_age=max_age,
        httponly=True,
        secure=get_session_cookie_secure(),
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=get_session_cookie_name(),
        secure=get_session_cookie_secure(),
        samesite="lax",
        path="/",
    )


def get_current_user(request: Request, db: DbSession) -> User:
    raw_token = request.cookies.get(get_session_cookie_name())
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    user = get_user_by_session_token(db, raw_token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post(
    "/google",
    response_model=AuthUserResponse,
    status_code=status.HTTP_200_OK,
    summary="Authenticate with Google ID token",
)
def authenticate_with_google(
    payload: GoogleAuthRequest,
    response: Response,
    db: DbSession,
) -> AuthUserResponse:
    try:
        token_payload = id_token.verify_oauth2_token(
            payload.credential,
            google_requests.Request(),
            get_google_client_id(),
        )
    except Exception as exc:
        logger.exception("Google authentication failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to verify Google sign-in.",
        ) from exc

    if not token_payload.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account email is not verified.",
        )

    google_sub = str(token_payload.get("sub", "")).strip()
    email = str(token_payload.get("email", "")).strip()
    name = str(token_payload.get("name") or email.split("@")[0]).strip()
    picture_url = token_payload.get("picture")

    if not google_sub or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Google account identity fields.",
        )

    user = upsert_google_user(
        db,
        google_sub=google_sub,
        email=email,
        name=name,
        picture_url=str(picture_url) if picture_url else None,
    )
    raw_token = create_user_session(db, user_id=user.id)
    _set_session_cookie(response, raw_token)
    return serialize_auth_user(user)


@router.get(
    "/me",
    response_model=AuthUserResponse,
    status_code=status.HTTP_200_OK,
    summary="Get current signed-in user",
)
def get_me(current_user: CurrentUser) -> AuthUserResponse:
    return serialize_auth_user(current_user)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Log out current session",
)
def logout(request: Request, response: Response, db: DbSession) -> None:
    raw_token = request.cookies.get(get_session_cookie_name())
    if raw_token:
        delete_user_session(db, raw_token)
    _clear_session_cookie(response)


@router.delete(
    "/me/data",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete all data for the current user",
)
def delete_my_data(current_user: CurrentUser, db: DbSession) -> None:
    clear_user_data(db, current_user.id)


@router.post(
    "/logout-all",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Log out all sessions for the current user",
)
def logout_all_sessions(
    current_user: CurrentUser,
    response: Response,
    db: DbSession,
) -> None:
    delete_all_user_sessions(db, current_user.id)
    _clear_session_cookie(response)
