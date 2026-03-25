from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel, Field
from typing_extensions import TypedDict


QuestionType = Literal["是非題", "單選題", "多選題", "情境題", "錯題改寫"]
DifficultyLevel = Literal["very_easy", "easy", "medium", "hard", "very_hard"]
ScoreBand = Literal[0, 25, 50, 75, 100]

ALLOWED_DIFFICULTIES = {"very_easy", "easy", "medium", "hard", "very_hard"}


class SummarySchema(BaseModel):
    points: dict[str, str]


class SpecItem(BaseModel):
    type: QuestionType = Field(description="題型")
    count: int = Field(description="此題型要出幾題")
    goal: str = Field(description="此題型的大致出題方向與目的")


class SpecSchema(BaseModel):
    items: list[SpecItem]


class QuestionItem(BaseModel):
    type: QuestionType
    stem: str = Field(description="題目敘述")
    options: list[str] = Field(
        default_factory=list,
        description="若為單選題或多選題，放選項；其他題型為空陣列",
    )
    answer: Union[str, list[str]] = Field(
        description="是非/單選/情境/錯題改寫為字串，多選題為答案字母列表"
    )


class QuizOutputSchema(BaseModel):
    questions: list[QuestionItem]


class JudgeResultSchema(BaseModel):
    feedback: str = Field(description="第二人稱對考生的批改敘述")
    score: ScoreBand = Field(description="評分等級")


class QuizState(TypedDict):
    content: str
    difficulty: str
    preference: str
    numbers: int
    summary: dict
    spec: dict
    questions: list[dict]
