from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .auth import AdminUser
from .db import (
    DEFAULT_DAILY_QUIZ_LIMIT,
    DEFAULT_DAILY_RETAKE_LIMIT,
    count_quiz_generations_today,
    count_quiz_retakes_today,
    count_total_attempts_for_user,
    count_total_quizzes_for_user,
    get_db_session,
    get_user_by_id,
    list_all_users,
    update_user_access,
)

router = APIRouter(prefix="/admin", tags=["admin"])
DbSession = Annotated[Session, Depends(get_db_session)]


class AdminUserSummary(BaseModel):
    id: str
    name: str
    email: str
    plan: str
    is_admin: bool
    daily_quiz_limit: int
    daily_retake_limit: int
    quizzes_generated_today: int
    retakes_today: int
    total_quizzes: int
    total_attempts: int
    created_at: datetime
    last_login_at: datetime | None


class AdminUserAccessUpdateRequest(BaseModel):
    is_admin: bool = False
    daily_quiz_limit: int = Field(default=DEFAULT_DAILY_QUIZ_LIMIT, ge=0, le=1000)
    daily_retake_limit: int = Field(default=DEFAULT_DAILY_RETAKE_LIMIT, ge=0, le=1000)


def _serialize_user(db: Session, user) -> AdminUserSummary:
    return AdminUserSummary(
        id=user.id,
        name=user.name,
        email=user.email,
        plan=user.plan,
        is_admin=user.is_admin,
        daily_quiz_limit=user.daily_quiz_limit,
        daily_retake_limit=user.daily_retake_limit,
        quizzes_generated_today=count_quiz_generations_today(db, user.id),
        retakes_today=count_quiz_retakes_today(db, user.id),
        total_quizzes=count_total_quizzes_for_user(db, user.id),
        total_attempts=count_total_attempts_for_user(db, user.id),
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


@router.get(
    "/users",
    response_model=list[AdminUserSummary],
    status_code=status.HTTP_200_OK,
    summary="List all users and current quotas",
)
def list_users(_: AdminUser, db: DbSession) -> list[AdminUserSummary]:
    return [_serialize_user(db, user) for user in list_all_users(db)]


@router.patch(
    "/users/{user_id}/access",
    response_model=AdminUserSummary,
    status_code=status.HTTP_200_OK,
    summary="Update per-user admin access and daily quotas",
)
def patch_user_access(
    user_id: str,
    payload: AdminUserAccessUpdateRequest,
    _: AdminUser,
    db: DbSession,
) -> AdminUserSummary:
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    updated_user = update_user_access(
        db,
        user,
        is_admin=payload.is_admin,
        daily_quiz_limit=payload.daily_quiz_limit,
        daily_retake_limit=payload.daily_retake_limit,
    )
    return _serialize_user(db, updated_user)
