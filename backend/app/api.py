from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated, Union

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.logic import run_quiz_workflow
from .core.model import (
    DifficultyLevel,
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
    create_quiz_record,
    delete_quiz_record,
    get_db_session,
    save_quiz_score,
    update_quiz_record,
    update_quiz_title,
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


class QuizWorkflowResponse(BaseModel):
    id: str
    title: str
    content: str
    preference: str
    difficulty: DifficultyLevel
    numbers: int
    created_at: datetime
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


class QuizTitleUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)


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
        summary=record.summary,
        spec=record.spec,
        questions=record.questions,
        submitted_answers=record.submitted_answers,
        score_result=record.score_result,
    )


@router.post(
    "/quiz/run",
    response_model=QuizWorkflowResponse,
    status_code=status.HTTP_200_OK,
    summary="Run quiz workflow",
)
def run_quiz(payload: QuizWorkflowRequest, db: DbSession) -> QuizWorkflowResponse:
    result = _run_quiz_workflow_or_raise(payload)

    record = create_quiz_record(
        db,
        content=payload.content,
        preference=payload.preference,
        difficulty=payload.difficulty,
        numbers=payload.numbers,
        summary=result["summary"],
        spec=result["spec"],
        questions=result["questions"],
    )

    return _serialize_quiz_record(record)


@router.get(
    "/quizzes",
    response_model=list[QuizHistoryItem],
    status_code=status.HTTP_200_OK,
    summary="List saved quizzes",
)
def list_quizzes(db: DbSession) -> list[QuizHistoryItem]:
    statement = select(QuizRecord).order_by(QuizRecord.created_at.desc())
    records = db.scalars(statement).all()
    return [
        QuizHistoryItem(
            id=record.id,
            title=record.title,
            difficulty=record.difficulty,
            numbers=record.numbers,
            created_at=record.created_at,
        )
        for record in records
    ]


@router.get(
    "/quizzes/{quiz_id}",
    response_model=QuizWorkflowResponse,
    status_code=status.HTTP_200_OK,
    summary="Get saved quiz detail",
)
def get_quiz(quiz_id: str, db: DbSession) -> QuizWorkflowResponse:
    record = db.get(QuizRecord, quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

    return _serialize_quiz_record(record)


@router.put(
    "/quizzes/{quiz_id}/run",
    response_model=QuizWorkflowResponse,
    status_code=status.HTTP_200_OK,
    summary="Update saved quiz with a new workflow run",
)
def rerun_quiz(quiz_id: str, payload: QuizWorkflowRequest, db: DbSession) -> QuizWorkflowResponse:
    record = db.get(QuizRecord, quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

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

    return _serialize_quiz_record(updated_record)


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
) -> QuizScoreResponse:
    record = db.get(QuizRecord, quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

    answers_by_index = {
        item.question_index: item.answer
        for item in payload.answers
    }

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
        results=[
            QuizScoreQuestionResult(**result)
            for result in score_summary["results"]
        ],
    )

    save_quiz_score(
        db,
        record,
        submitted_answers={str(item.question_index): item.answer for item in payload.answers},
        score_result=response.model_dump(),
    )

    return response


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
) -> QuizHistoryItem:
    record = db.get(QuizRecord, quiz_id)
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
    )


@router.delete(
    "/quizzes/{quiz_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete saved quiz",
)
def delete_quiz(quiz_id: str, db: DbSession) -> None:
    record = db.get(QuizRecord, quiz_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz not found.",
        )

    delete_quiz_record(db, record)
