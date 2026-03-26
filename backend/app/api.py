from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated, Union

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .auth import CurrentUser
from .core.insights import (
    build_error_breakdown,
    compute_difficulty_performance,
    compute_error_type_breakdown,
    compute_history_trend,
    compute_question_type_performance,
)
from .core.logic import run_learning_profile_workflow, run_quiz_workflow
from .core.model import (
    DifficultyLevel,
    LearningProfileEntrySchema,
    QuestionItem,
    QuestionType,
    ScoreBand,
    SpecSchema,
    SummarySchema,
)
from .core.score import score_quiz_questions
from .db import (
    MAX_TITLE_LENGTH,
    QuizRecord,
    count_quiz_generations_today,
    count_quiz_retakes_today,
    create_quiz_record,
    delete_learning_profile_entry,
    delete_quiz_record,
    get_db_session,
    get_quiz_record_for_user,
    list_quiz_attempts_for_user,
    list_quiz_records_for_user,
    list_scored_quiz_records_for_user,
    record_quiz_generation,
    record_quiz_retake,
    save_quiz_score,
    touch_quiz_record,
    update_learning_profile_settings,
    update_quiz_record,
    update_quiz_title,
    upsert_learning_profile_entry,
)


logger = logging.getLogger(__name__)

router = APIRouter(tags=["quiz"])
DbSession = Annotated[Session, Depends(get_db_session)]


class QuizWorkflowRequest(BaseModel):
    content: str = Field(description="原始學習內容或筆記", max_length=10000)
    difficulty: DifficultyLevel = Field(default="medium", description="題目難度")
    preference: str = Field(default="", description="補充出題偏好", max_length=500)
    numbers: int = Field(default=10, ge=1, le=25, description="題目數量")


class QuizScoreAnswerItem(BaseModel):
    question_index: int = Field(ge=0)
    answer: Union[str, list[str]]


class QuizScoreRequest(BaseModel):
    answers: list[QuizScoreAnswerItem] = Field(default_factory=list)


class QuizScoreQuestionResult(BaseModel):
    question_index: int
    type: QuestionType
    max_score: float
    earned_score: float
    correctness_ratio: float
    user_answer: Union[str, list[str]]
    correct_answer: Union[str, list[str]]
    feedback: str | None = None
    rubric_band: ScoreBand | None = None


class QuizScoreResponse(BaseModel):
    quiz_id: str
    total_score: float
    max_score: float
    results: list[QuizScoreQuestionResult]


class HistoryTrendPoint(BaseModel):
    attempted_at: datetime
    total_score: float
    moving_average: float


class DifficultyPerformanceItem(BaseModel):
    difficulty: DifficultyLevel
    average_score: float
    attempts: int


class QuestionTypePerformanceItem(BaseModel):
    question_type: QuestionType
    ability_score: float
    answered: int


class ErrorTypeBreakdownItem(BaseModel):
    error_type: str
    count: int
    share: float


class LearningProfileOverviewItem(BaseModel):
    domain: str
    grade: str
    grade_score: float
    status: str


class LearningInsightsResponse(BaseModel):
    history_trend: list[HistoryTrendPoint]
    difficulty_performance: list[DifficultyPerformanceItem]
    question_type_performance: list[QuestionTypePerformanceItem]
    error_type_breakdown: list[ErrorTypeBreakdownItem]
    learning_profile_overview: list[LearningProfileOverviewItem]
    sampled_attempt_count: int


class QuizWorkflowResponse(BaseModel):
    id: str
    title: str
    content: str
    preference: str
    difficulty: DifficultyLevel
    numbers: int
    created_at: datetime
    updated_at: datetime
    summary: SummarySchema
    spec: SpecSchema
    questions: list[QuestionItem]
    submitted_answers: dict[str, Union[str, list[str]]] | None = None
    score_result: QuizScoreResponse | None = None


class QuizHistoryItem(BaseModel):
    id: str
    title: str
    difficulty: DifficultyLevel
    numbers: int
    created_at: datetime
    updated_at: datetime


class QuizTitleUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)


class DailyQuotaStatus(BaseModel):
    quizzes_generated_today: int
    quiz_limit_per_day: int
    retakes_today: int
    retake_limit_per_day: int


class LearningProfileSettingsRequest(BaseModel):
    enabled: bool


class LearningProfileResponse(BaseModel):
    enabled: bool
    entries: list[LearningProfileEntrySchema]


GRADE_TO_SCORE = {
    "A": 96.0,
    "A-": 92.0,
    "B+": 88.0,
    "B": 84.0,
    "B-": 80.0,
    "C+": 77.0,
    "C": 73.0,
    "C-": 70.0,
    "D": 64.0,
    "F": 50.0,
}


def _ensure_quiz_generation_quota(db: Session, user) -> None:
    used = count_quiz_generations_today(db, user.id)
    if used >= user.daily_quiz_limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Daily quiz limit reached ({user.daily_quiz_limit}/{user.daily_quiz_limit}).",
        )


def _ensure_retake_quota(db: Session, user) -> None:
    used = count_quiz_retakes_today(db, user.id)
    if used >= user.daily_retake_limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Daily retake limit reached ({user.daily_retake_limit}/{user.daily_retake_limit}).",
        )


def _run_quiz_workflow_or_raise(payload: QuizWorkflowRequest) -> dict:
    if not payload.content.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="content must not be empty.",
        )

    try:
        result = run_quiz_workflow(
            content=payload.content,
            difficulty=payload.difficulty,
            preference=payload.preference,
            numbers=payload.numbers,
        )
    except RuntimeError as exc:
        logger.exception("Quiz workflow configuration error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Quiz workflow failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Quiz workflow failed.",
        ) from exc

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="content must not be empty.",
        )

    return result


def _serialize_quiz_record(record: QuizRecord) -> QuizWorkflowResponse:
    return QuizWorkflowResponse(
        id=record.id,
        title=record.title,
        content=record.content,
        preference=record.preference,
        difficulty=record.difficulty,
        numbers=record.numbers,
        created_at=record.created_at,
        updated_at=record.updated_at,
        summary=record.summary,
        spec=record.spec,
        questions=record.questions,
        submitted_answers=record.submitted_answers,
        score_result=record.score_result,
    )


def _serialize_learning_profile(current_user) -> LearningProfileResponse:
    entries = [
        LearningProfileEntrySchema(
            domain=entry.get("domain", ""),
            status=entry.get("status", ""),
            grade=entry.get("grade", "C"),
        )
        for entry in (current_user.learning_profile or [])
        if entry.get("domain")
    ]
    return LearningProfileResponse(
        enabled=current_user.learning_profile_enabled,
        entries=entries,
    )


@router.post(
    "/quiz/run",
    response_model=QuizWorkflowResponse,
    status_code=status.HTTP_200_OK,
    summary="Run quiz workflow",
)
def run_quiz(payload: QuizWorkflowRequest, db: DbSession, current_user: CurrentUser) -> QuizWorkflowResponse:
    _ensure_quiz_generation_quota(db, current_user)
    result = _run_quiz_workflow_or_raise(payload)

    record = create_quiz_record(
        db,
        user_id=current_user.id,
        content=payload.content,
        preference=payload.preference,
        difficulty=payload.difficulty,
        numbers=payload.numbers,
        summary=result["summary"],
        spec=result["spec"],
        questions=result["questions"],
    )
    record_quiz_generation(db, user_id=current_user.id, quiz_record_id=record.id, action="create")

    return _serialize_quiz_record(record)


@router.get(
    "/quizzes",
    response_model=list[QuizHistoryItem],
    status_code=status.HTTP_200_OK,
    summary="List saved quizzes",
)
def list_quizzes(db: DbSession, current_user: CurrentUser) -> list[QuizHistoryItem]:
    records = list_quiz_records_for_user(db, current_user.id)
    return [
        QuizHistoryItem(
            id=record.id,
            title=record.title,
            difficulty=record.difficulty,
            numbers=record.numbers,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )
        for record in records
    ]


@router.get(
    "/quizzes/{quiz_id}",
    response_model=QuizWorkflowResponse,
    status_code=status.HTTP_200_OK,
    summary="Get saved quiz detail",
)
def get_quiz(quiz_id: str, db: DbSession, current_user: CurrentUser) -> QuizWorkflowResponse:
    record = get_quiz_record_for_user(db, user_id=current_user.id, quiz_id=quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

    return _serialize_quiz_record(touch_quiz_record(db, record))


@router.put(
    "/quizzes/{quiz_id}/run",
    response_model=QuizWorkflowResponse,
    status_code=status.HTTP_200_OK,
    summary="Update saved quiz with a new workflow run",
)
def rerun_quiz(
    quiz_id: str,
    payload: QuizWorkflowRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> QuizWorkflowResponse:
    record = get_quiz_record_for_user(db, user_id=current_user.id, quiz_id=quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

    _ensure_quiz_generation_quota(db, current_user)
    result = _run_quiz_workflow_or_raise(payload)
    updated_record = update_quiz_record(
        db,
        record,
        content=payload.content,
        preference=payload.preference,
        difficulty=payload.difficulty,
        numbers=payload.numbers,
        summary=result["summary"],
        spec=result["spec"],
        questions=result["questions"],
    )
    record_quiz_generation(db, user_id=current_user.id, quiz_record_id=updated_record.id, action="rerun")

    return _serialize_quiz_record(updated_record)


@router.post(
    "/quizzes/{quiz_id}/retake",
    response_model=DailyQuotaStatus,
    status_code=status.HTTP_200_OK,
    summary="Register a retake for the current user",
)
def retake_quiz(quiz_id: str, db: DbSession, current_user: CurrentUser) -> DailyQuotaStatus:
    record = get_quiz_record_for_user(db, user_id=current_user.id, quiz_id=quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

    _ensure_retake_quota(db, current_user)
    record_quiz_retake(db, user_id=current_user.id, quiz_record_id=record.id)
    return DailyQuotaStatus(
        quizzes_generated_today=count_quiz_generations_today(db, current_user.id),
        quiz_limit_per_day=current_user.daily_quiz_limit,
        retakes_today=count_quiz_retakes_today(db, current_user.id),
        retake_limit_per_day=current_user.daily_retake_limit,
    )


@router.post(
    "/quizzes/{quiz_id}/score",
    response_model=QuizScoreResponse,
    status_code=status.HTTP_200_OK,
    summary="Score quiz answers",
)
def score_quiz(
    quiz_id: str,
    payload: QuizScoreRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> QuizScoreResponse:
    record = get_quiz_record_for_user(db, user_id=current_user.id, quiz_id=quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

    answers_by_index = {item.question_index: item.answer for item in payload.answers}

    try:
        score_summary = score_quiz_questions(record.questions, answers_by_index)
    except RuntimeError as exc:
        logger.exception("Quiz scoring configuration error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Quiz scoring failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Quiz scoring failed.",
        ) from exc

    response = QuizScoreResponse(
        quiz_id=record.id,
        total_score=score_summary["total_score"],
        max_score=score_summary["max_score"],
        results=[QuizScoreQuestionResult(**result) for result in score_summary["results"]],
    )

    submitted_answers = {str(item.question_index): item.answer for item in payload.answers}
    save_quiz_score(
        db,
        record,
        submitted_answers=submitted_answers,
        score_result=response.model_dump(),
        error_breakdown=build_error_breakdown(response.model_dump()),
    )

    if current_user.learning_profile_enabled:
        knowledge_points = list(record.summary.get("points", {}).keys())[:3]
        learning_result = run_learning_profile_workflow(
            learning_profile=current_user.learning_profile or [],
            knowledge_points=knowledge_points,
            score_payload={
                "quiz_title": record.title,
                "summary_points": knowledge_points,
                "questions": record.questions,
                "submitted_answers": submitted_answers,
                "score_result": response.model_dump(),
            },
        )
        updated_entry = learning_result.get("updated_entry") or {}
        if updated_entry.get("domain") and updated_entry.get("status") and updated_entry.get("grade"):
            upsert_learning_profile_entry(
                db,
                current_user,
                domain=updated_entry["domain"],
                status=updated_entry["status"],
                grade=updated_entry["grade"],
            )

    return response


@router.get(
    "/insights",
    response_model=LearningInsightsResponse,
    status_code=status.HTTP_200_OK,
    summary="Get learning insights",
)
def get_learning_insights(db: DbSession, current_user: CurrentUser) -> LearningInsightsResponse:
    current_records = list_scored_quiz_records_for_user(db, current_user.id)
    attempts = list_quiz_attempts_for_user(db, current_user.id)
    error_type_breakdown, sampled_attempt_count = compute_error_type_breakdown(attempts, limit=20)

    return LearningInsightsResponse(
        history_trend=compute_history_trend(attempts),
        difficulty_performance=compute_difficulty_performance(current_records),
        question_type_performance=compute_question_type_performance(current_records),
        error_type_breakdown=error_type_breakdown,
        learning_profile_overview=[
            LearningProfileOverviewItem(
                domain=entry.get("domain", ""),
                grade=entry.get("grade", "C"),
                grade_score=GRADE_TO_SCORE.get(entry.get("grade", "C"), 73.0),
                status=entry.get("status", ""),
            )
            for entry in (current_user.learning_profile or [])
            if entry.get("domain")
        ],
        sampled_attempt_count=sampled_attempt_count,
    )


@router.get(
    "/learning-profile",
    response_model=LearningProfileResponse,
    status_code=status.HTTP_200_OK,
    summary="Get current user's learning profile",
)
def get_learning_profile(current_user: CurrentUser) -> LearningProfileResponse:
    return _serialize_learning_profile(current_user)


@router.patch(
    "/learning-profile/settings",
    response_model=LearningProfileResponse,
    status_code=status.HTTP_200_OK,
    summary="Update learning profile automation settings",
)
def patch_learning_profile_settings(
    payload: LearningProfileSettingsRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> LearningProfileResponse:
    updated_user = update_learning_profile_settings(db, current_user, enabled=payload.enabled)
    return _serialize_learning_profile(updated_user)


@router.delete(
    "/learning-profile/entries/{domain_name}",
    response_model=LearningProfileResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete one learning profile entry",
)
def remove_learning_profile_entry(
    domain_name: str,
    db: DbSession,
    current_user: CurrentUser,
) -> LearningProfileResponse:
    updated_user = delete_learning_profile_entry(db, current_user, domain=domain_name)
    return _serialize_learning_profile(updated_user)


@router.patch(
    "/quizzes/{quiz_id}/title",
    response_model=QuizHistoryItem,
    status_code=status.HTTP_200_OK,
    summary="Update saved quiz title",
)
def patch_quiz_title(
    quiz_id: str,
    payload: QuizTitleUpdateRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> QuizHistoryItem:
    record = get_quiz_record_for_user(db, user_id=current_user.id, quiz_id=quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

    normalized_title = payload.title.strip()
    if not normalized_title:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="title must not be empty.",
        )

    updated_record = update_quiz_title(db, record, normalized_title)
    return QuizHistoryItem(
        id=updated_record.id,
        title=updated_record.title,
        difficulty=updated_record.difficulty,
        numbers=updated_record.numbers,
        created_at=updated_record.created_at,
        updated_at=updated_record.updated_at,
    )


@router.delete(
    "/quizzes/{quiz_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete saved quiz",
)
def delete_quiz(quiz_id: str, db: DbSession, current_user: CurrentUser) -> None:
    record = get_quiz_record_for_user(db, user_id=current_user.id, quiz_id=quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

    delete_quiz_record(db, record)
