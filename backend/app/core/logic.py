from __future__ import annotations

from .graph import get_quiz_graph
from .model import ALLOWED_DIFFICULTIES, DifficultyLevel


def run_quiz_workflow(
    content: str,
    difficulty: DifficultyLevel = "medium",
    preference: str = "",
    numbers: int = 10,
):
    if not content or not content.strip():
        return None

    normalized_difficulty = difficulty
    if normalized_difficulty not in ALLOWED_DIFFICULTIES:
        normalized_difficulty = "medium"

    quiz_graph = get_quiz_graph()

    return quiz_graph.invoke(
        {
            "content": content,
            "difficulty": normalized_difficulty,
            "preference": preference,
            "numbers": numbers,
            "summary": {},
            "spec": {},
            "questions": [],
        }
    )
