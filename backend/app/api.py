from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .core.logic import run_quiz_workflow
from .core.model import DifficultyLevel, QuestionItem, SpecSchema, SummarySchema


logger = logging.getLogger(__name__)

router = APIRouter(tags=["quiz"])


class QuizWorkflowRequest(BaseModel):
    content: str = Field(description="原始學習內容或筆記")
    difficulty: DifficultyLevel = Field(default="medium", description="題目難度")
    preference: str = Field(default="", description="補充出題偏好")
    numbers: int = Field(default=10, ge=1, description="題目數量")


class QuizWorkflowResponse(BaseModel):
    summary: SummarySchema
    spec: SpecSchema
    questions: list[QuestionItem]


@router.post(
    "/quiz/run",
    response_model=QuizWorkflowResponse,
    status_code=status.HTTP_200_OK,
    summary="Run quiz workflow",
)
def run_quiz(payload: QuizWorkflowRequest) -> QuizWorkflowResponse:
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

    return QuizWorkflowResponse(**result)
