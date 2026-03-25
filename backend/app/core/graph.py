from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from .llm import get_llm
from .model import QuizOutputSchema, QuizState, SpecSchema, SummarySchema


def summarize_content(state: QuizState) -> dict:
    structured_llm = get_llm().with_structured_output(SummarySchema)

    prompt = f"""你是一個筆記專家，以下是一份原始筆記:
<START>{state['content']}<END>

謹慎思考，並將原始筆記中的*重要*知識點歸納整理成 "知識點":"知識內容敘述"
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
考試範圍:<START>:{state['summary']}<END>
出題規格:{state['spec']}

出題要求:
1. 嚴格依照規格中的題型與題數
2. 單選題與多選題才填 options
3. 是非題 answer 請填 O 或 X
4. 單選題 answer 請填單一字母，例如 A
5. 多選題 answer 請填字母陣列，例如 ["A", "C"]
6. 情境題與錯題改寫 answer 填寫精簡約兩三句的解答
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
