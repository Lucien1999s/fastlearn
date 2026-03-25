from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import TypedDict, Union

from .logic import llm_judge
from .model import QuestionItem, QuestionType


TOTAL_SCORE = Decimal("100.00")
OPEN_ENDED_TYPES = {"情境題", "錯題改寫"}
MULTIPLE_CHOICE_TYPE = "多選題"
EXACT_MATCH_TYPES = {"是非題", "單選題"}

AnswerValue = Union[str, list[str]]


class ScoreQuestionResult(TypedDict):
    question_index: int
    type: QuestionType
    max_score: float
    earned_score: float
    correctness_ratio: float
    user_answer: AnswerValue
    correct_answer: AnswerValue
    feedback: str | None
    rubric_band: int | None


class ScoreSummary(TypedDict):
    total_score: float
    max_score: float
    results: list[ScoreQuestionResult]


def _round_score(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _build_question_weights(question_count: int) -> list[Decimal]:
    if question_count <= 0:
        return []

    total_cents = int(TOTAL_SCORE * 100)
    base_cents, remainder = divmod(total_cents, question_count)

    weights: list[Decimal] = []
    for index in range(question_count):
        cents = base_cents + (1 if index < remainder else 0)
        weights.append(Decimal(cents) / Decimal("100"))

    return weights


def _normalize_answer(question: QuestionItem, raw_answer: AnswerValue | None) -> AnswerValue:
    if question.type == MULTIPLE_CHOICE_TYPE:
        if not isinstance(raw_answer, list):
            return []

        normalized = {
            str(value).strip().upper()
            for value in raw_answer
            if str(value).strip()
        }
        return sorted(normalized)

    if raw_answer is None:
        return ""

    if isinstance(raw_answer, list):
        return ""

    return str(raw_answer).strip()


def _score_exact_match(question: QuestionItem, user_answer: AnswerValue) -> Decimal:
    normalized_user_answer = str(user_answer).strip().upper()
    normalized_correct_answer = str(question.answer).strip().upper()
    return Decimal("1") if normalized_user_answer == normalized_correct_answer else Decimal("0")


def _score_multiple_choice(question: QuestionItem, user_answer: AnswerValue) -> Decimal:
    normalized_user_answer = set(user_answer if isinstance(user_answer, list) else [])
    correct_answers = set(
        option.strip().upper()
        for option in (question.answer if isinstance(question.answer, list) else [])
    )

    if not correct_answers:
        return Decimal("0")

    selected_correct_count = len(normalized_user_answer & correct_answers)
    selected_wrong_count = len(normalized_user_answer - correct_answers)
    numerator = Decimal(selected_correct_count - selected_wrong_count)
    denominator = Decimal(len(correct_answers))
    ratio = numerator / denominator
    return max(ratio, Decimal("0"))


def _score_open_ended(question: QuestionItem, user_answer: AnswerValue) -> tuple[Decimal, str | None, int | None]:
    normalized_user_answer = str(user_answer).strip()
    if not normalized_user_answer:
        return Decimal("0"), "You did not provide an answer.", 0

    feedback, band = llm_judge(
        question=question.stem,
        answer=normalized_user_answer,
        ground_truth=str(question.answer),
        q_type=question.type,
    )
    return Decimal(band) / Decimal("100"), feedback, band


def score_quiz_questions(
    questions: list[QuestionItem | dict],
    answers_by_index: dict[int, AnswerValue],
) -> ScoreSummary:
    weights = _build_question_weights(len(questions))
    results: list[ScoreQuestionResult] = []
    total_score = Decimal("0")

    for index, raw_question in enumerate(questions):
        question = (
            raw_question
            if isinstance(raw_question, QuestionItem)
            else QuestionItem.model_validate(raw_question)
        )
        max_score = weights[index]
        user_answer = _normalize_answer(question, answers_by_index.get(index))
        feedback: str | None = None
        rubric_band: int | None = None

        if question.type in EXACT_MATCH_TYPES:
            ratio = _score_exact_match(question, user_answer)
        elif question.type == MULTIPLE_CHOICE_TYPE:
            ratio = _score_multiple_choice(question, user_answer)
        elif question.type in OPEN_ENDED_TYPES:
            ratio, feedback, rubric_band = _score_open_ended(question, user_answer)
        else:
            ratio = Decimal("0")

        earned_score = (max_score * ratio).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_score += earned_score

        results.append(
            {
                "question_index": index,
                "type": question.type,
                "max_score": _round_score(max_score),
                "earned_score": _round_score(earned_score),
                "correctness_ratio": float(ratio),
                "user_answer": user_answer,
                "correct_answer": question.answer,
                "feedback": feedback,
                "rubric_band": rubric_band,
            }
        )

    return {
        "total_score": _round_score(total_score),
        "max_score": _round_score(TOTAL_SCORE),
        "results": results,
    }
