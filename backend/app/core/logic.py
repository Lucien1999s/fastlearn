from __future__ import annotations

from typing import Tuple

from .llm import get_llm
from .graph import get_learning_profile_graph, get_quiz_graph
from .model import ALLOWED_DIFFICULTIES, DifficultyLevel, JudgeResultSchema


def llm_judge(
    question: str,
    answer: str,
    ground_truth: str,
    q_type: str
) -> Tuple[str, int]:
    if q_type == "情境題":
        prompt = f"""你是一個專業評分員，你會根據答題結果評分
題目: {question}
答題: {answer}
參考解: {ground_truth}

評分依據: 答題結果對於此情境題解的好壞/正確
分數評級: 0, 25, 50, 75, 100
請給分數評級和第二人稱對考生的批改敘述，輸出如: [str, int]
"""
    else:
        prompt = f"""你是一個專業評分員，你會根據答題結果評分
題目: {question}
答題: {answer}
參考解: {ground_truth}

評分依據: 答題結果對於此錯題改寫改的完整與否
分數評級: 0, 25, 50, 75, 100
請給分數評級和第二人稱對考生的批改敘述，輸出如: [str, int]
"""
    structured_llm = get_llm().with_structured_output(JudgeResultSchema)
    resp = structured_llm.invoke(prompt)
    return resp.feedback, resp.score


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


def run_learning_profile_workflow(
    *,
    learning_profile: list[dict],
    knowledge_points: list[str],
    score_payload: dict,
) -> dict:
    learning_graph = get_learning_profile_graph()
    return learning_graph.invoke(
        {
            "learning_profile": learning_profile,
            "knowledge_points": knowledge_points,
            "score_payload": score_payload,
            "resolved_domain": "",
            "matched_entry": {},
            "updated_entry": {},
        }
    )
