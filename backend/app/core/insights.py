from __future__ import annotations

from collections import deque
from typing import Any, Iterable


DIFFICULTY_ORDER = ["very_easy", "easy", "medium", "hard", "very_hard"]
QUESTION_TYPE_ORDER = ["是非題", "單選題", "多選題", "情境題", "錯題改寫"]
ERROR_TYPE_ORDER = [
    "基礎概念錯誤",
    "漏關鍵點",
    "推理不完整",
    "誤選干擾選項",
    "漏選正確選項",
]


def build_error_breakdown(score_result: dict[str, Any]) -> dict[str, int]:
    counts = {key: 0 for key in ERROR_TYPE_ORDER}

    for result in score_result.get("results", []):
        question_type = result.get("type")
        earned_score = float(result.get("earned_score", 0))
        max_score = float(result.get("max_score", 0))
        user_answer = result.get("user_answer")
        correct_answer = result.get("correct_answer")
        rubric_band = result.get("rubric_band")

        if max_score <= 0 or earned_score >= max_score:
            continue

        if question_type == "是非題":
            counts["基礎概念錯誤"] += 1
            continue

        if question_type == "單選題":
            counts["誤選干擾選項"] += 1
            continue

        if question_type == "多選題":
            selected_values = set(user_answer if isinstance(user_answer, list) else [])
            correct_values = set(correct_answer if isinstance(correct_answer, list) else [])
            wrong_selected = len(selected_values - correct_values)
            missed_correct = len(correct_values - selected_values)

            counts["誤選干擾選項"] += wrong_selected
            counts["漏選正確選項"] += missed_correct
            continue

        if question_type == "情境題":
            if rubric_band in (0, 25, 50):
                counts["推理不完整"] += 1
            else:
                counts["漏關鍵點"] += 1
            continue

        if question_type == "錯題改寫":
            if rubric_band in (0, 25):
                counts["基礎概念錯誤"] += 1
            else:
                counts["漏關鍵點"] += 1

    return counts


def compute_history_trend(attempts: Iterable[Any]) -> list[dict[str, Any]]:
    rolling_window: deque[float] = deque(maxlen=7)
    points: list[dict[str, Any]] = []

    for attempt in sorted(attempts, key=lambda item: item.created_at):
        total_score = float(attempt.total_score)
        rolling_window.append(total_score)
        moving_average = sum(rolling_window) / len(rolling_window)
        points.append(
            {
                "attempted_at": attempt.created_at,
                "total_score": round(total_score, 2),
                "moving_average": round(moving_average, 2),
            }
        )

    return points


def compute_difficulty_performance(records: Iterable[Any]) -> list[dict[str, Any]]:
    buckets = {
        difficulty: {"sum": 0.0, "count": 0}
        for difficulty in DIFFICULTY_ORDER
    }

    for record in records:
        if not record.score_result:
            continue
        difficulty = record.difficulty
        if difficulty not in buckets:
            continue
        buckets[difficulty]["sum"] += float(record.score_result.get("total_score", 0))
        buckets[difficulty]["count"] += 1

    return [
        {
            "difficulty": difficulty,
            "average_score": round(
                buckets[difficulty]["sum"] / buckets[difficulty]["count"],
                2,
            )
            if buckets[difficulty]["count"]
            else 0.0,
            "attempts": buckets[difficulty]["count"],
        }
        for difficulty in DIFFICULTY_ORDER
    ]


def compute_question_type_performance(records: Iterable[Any]) -> list[dict[str, Any]]:
    buckets = {
        question_type: {"earned": 0.0, "max": 0.0, "count": 0}
        for question_type in QUESTION_TYPE_ORDER
    }

    for record in records:
        if not record.score_result:
            continue
        for result in record.score_result.get("results", []):
            question_type = result.get("type")
            if question_type not in buckets:
                continue
            buckets[question_type]["earned"] += float(result.get("earned_score", 0))
            buckets[question_type]["max"] += float(result.get("max_score", 0))
            buckets[question_type]["count"] += 1

    performance: list[dict[str, Any]] = []
    for question_type in QUESTION_TYPE_ORDER:
        max_score = buckets[question_type]["max"]
        ability_score = (buckets[question_type]["earned"] / max_score * 100) if max_score else 0.0
        performance.append(
            {
                "question_type": question_type,
                "ability_score": round(ability_score, 2),
                "answered": buckets[question_type]["count"],
            }
        )

    return performance


def compute_error_type_breakdown(attempts: Iterable[Any], limit: int = 20) -> tuple[list[dict[str, Any]], int]:
    recent_attempts = sorted(attempts, key=lambda item: item.created_at, reverse=True)[:limit]
    total = 0
    counts = {key: 0 for key in ERROR_TYPE_ORDER}

    for attempt in recent_attempts:
        breakdown = attempt.error_breakdown or {}
        for error_type in ERROR_TYPE_ORDER:
            count = int(breakdown.get(error_type, 0))
            counts[error_type] += count
            total += count

    items = [
        {
            "error_type": error_type,
            "count": counts[error_type],
            "share": round((counts[error_type] / total * 100), 2) if total else 0.0,
        }
        for error_type in ERROR_TYPE_ORDER
    ]
    return items, len(recent_attempts)
