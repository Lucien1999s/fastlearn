from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from .llm import get_llm
from .model import (
    LearningProfileDomainResolutionSchema,
    LearningProfileState,
    LearningProfileUpdateSchema,
    QuizOutputSchema,
    QuizState,
    SpecSchema,
    SummarySchema,
)


def summarize_content(state: QuizState) -> dict:
    structured_llm = get_llm().with_structured_output(SummarySchema)

    prompt = f"""你是一個筆記專家，以下是一份原始筆記:
{state['content']}

謹慎思考，使用語言和以上原始筆記用的主要語言一致，並將原始筆記中的*重要*知識點歸納整理成 "知識點":"知識內容敘述"
"""

    response = structured_llm.invoke(prompt)
    return {"summary": response.model_dump()}


def plan_spec(state: QuizState) -> dict:
    structured_llm = get_llm().with_structured_output(SpecSchema)

    prompt = f"""你是一個學習規劃師，你正為A學生規劃練習題，你會評估內容類型和各項情況來寫出題規劃
內容: <START>:{state['summary']}<END>

考量到學生情況，你認為難易度為 {state['difficulty']}，總共出 {state['numbers']} 題最合適
且你認為 {state['preference']}

可用題型: 是非題、單選題、多選題、情境題、錯題改寫
謹慎思考，根據情況選 1~3 種題型，並規劃各自題數與出題方向。
"""

    response = structured_llm.invoke(prompt)
    return {"spec": response.model_dump()}


def generate_questions(state: QuizState) -> dict:
    structured_llm = get_llm().with_structured_output(QuizOutputSchema)

    prompt = f"""你是專業出題考官，你將根據出題規格和考試範圍出題
考試範圍:{state['summary']}
出題規格:{state['spec']}

出題要求:
1. 嚴格依照規格中的題型與題數
2. 單選題與多選題才填 options
3. 是非題 answer 請填 O 或 X
4. 單選題 answer 請填單一字母，例如 A
5. 多選題 answer 請填字母陣列，例如 ["A", "C"]
6. 情境題與錯題改寫 answer 填寫精簡約兩三句的解答
7. 使用語言: 請和上面考試範圍用的語言一樣
"""

    response = structured_llm.invoke(prompt)
    return {"questions": response.model_dump()["questions"]}


@lru_cache(maxsize=1)
def get_quiz_graph():
    builder = StateGraph(QuizState)

    builder.add_node("summarize_content", summarize_content)
    builder.add_node("plan_spec", plan_spec)
    builder.add_node("generate_questions", generate_questions)

    builder.add_edge(START, "summarize_content")
    builder.add_edge("summarize_content", "plan_spec")
    builder.add_edge("plan_spec", "generate_questions")
    builder.add_edge("generate_questions", END)

    return builder.compile()


def resolve_learning_domain(state: LearningProfileState) -> dict:
    structured_llm = get_llm().with_structured_output(LearningProfileDomainResolutionSchema)

    prompt = f"""你是一個學習檔案整理員。
你會根據既有的學習檔案與這次考試涵蓋的知識點，判斷這次內容屬於哪一個「大領域」。

既有學習檔案:
{state['learning_profile']}

本次知識點(前三個):
{state['knowledge_points']}

要求:
1. 必須使用大領域名稱，不要用太細碎的子概念命名
2. 若既有某領域能代表，請沿用既有領域名稱
3. 若沒有合適領域，建立一個新的大領域名稱
"""

    response = structured_llm.invoke(prompt)
    matched_entry = next(
        (entry for entry in state["learning_profile"] if entry.get("domain") == response.domain),
        {},
    )
    return {
        "resolved_domain": response.domain,
        "matched_entry": matched_entry,
    }


def update_learning_profile_entry(state: LearningProfileState) -> dict:
    structured_llm = get_llm().with_structured_output(LearningProfileUpdateSchema)

    prompt = f"""你是一個學習教練，會根據學生最新一次考試結果，更新其某個大領域的學習檔案。

既有該領域紀錄:
{state['matched_entry']}

本次考試所屬大領域:
{state['resolved_domain']}

本次成績單資訊:
{state['score_payload']}

要求:
1. 只輸出更新後的學習狀況與評等
2. 學習狀況以一到兩句為限，聚焦學生在此大領域的掌握度、弱點或進步
3. 評等採用美式字母等第，例如 A、A-、B+、B、B-、C+、C、C-、D、F
4. 若表現穩定進步，可給較高評等；若基礎仍不穩，評等應保守
"""

    response = structured_llm.invoke(prompt)
    return {
        "updated_entry": {
            "domain": state["resolved_domain"],
            "status": response.status,
            "grade": response.grade,
        }
    }


@lru_cache(maxsize=1)
def get_learning_profile_graph():
    builder = StateGraph(LearningProfileState)

    builder.add_node("resolve_learning_domain", resolve_learning_domain)
    builder.add_node("update_learning_profile_entry", update_learning_profile_entry)

    builder.add_edge(START, "resolve_learning_domain")
    builder.add_edge("resolve_learning_domain", "update_learning_profile_entry")
    builder.add_edge("update_learning_profile_entry", END)

    return builder.compile()
