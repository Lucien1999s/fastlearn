import os
from typing import Literal
from typing_extensions import TypedDict
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, START, END
from dotenv import load_dotenv

load_dotenv()

if "GOOGLE_API_KEY" not in os.environ:
    os.environ["GOOGLE_API_KEY"] = os.getenv("GOOGLE_API_KEY")


llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    temperature=0
)


QuestionType = Literal["是非題", "單選題", "多選題", "情境題", "錯題改寫"]
DifficultyLevel = Literal["very_easy", "easy", "medium", "hard", "very_hard"]


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
        description="若為單選題或多選題，放選項；其他題型為空陣列"
    )
    answer: str | list[str] = Field(
        description="是非/單選/情境/錯題改寫為字串，多選題為答案字母列表"
    )


class QuizOutputSchema(BaseModel):
    questions: list[QuestionItem]


class QuizState(TypedDict):
    content: str
    difficulty: str
    preference: str
    numbers: int
    summary: dict
    spec: dict
    questions: list[dict]


def summarize_content(state: QuizState):
    structured_llm = llm.with_structured_output(SummarySchema)

    prompt = f"""你是一個筆記專家，以下是一份原始筆記:
<START>{state['content']}<END>

謹慎思考，並將原始筆記中的*重要*知識點歸納整理成 "知識點":"知識內容敘述"
"""

    response = structured_llm.invoke(prompt)
    return {"summary": response.model_dump()}


def plan_spec(state: QuizState):
    structured_llm = llm.with_structured_output(SpecSchema)

    prompt = f"""你是一個學習規劃師，你正為A學生規劃練習題，你會評估內容類型和各項情況來寫出題規劃
內容: <START>:{state['summary']}<END>

考量到學生情況，你認為難易度為 {state['difficulty']}，總共出 {state['numbers']} 題最合適
且你認為 {state['preference']}

可用題型: 是非題、單選題、多選題、情境題、錯題改寫
謹慎思考，根據情況選 1~3 種題型，並規劃各自題數與出題方向。
"""

    response = structured_llm.invoke(prompt)
    return {"spec": response.model_dump()}


def generate_questions(state: QuizState):
    structured_llm = llm.with_structured_output(QuizOutputSchema)

    prompt = f"""你是專業出題考官，你將根據出題規格和考試範圍出題
考試範圍:<START>:{state['summary']}<END>
出題規格:{state['spec']}

出題要求:
1. 嚴格依照規格中的題型與題數
2. 單選題與多選題才填 options
3. 是非題 answer 請填 O 或 X
4. 單選題 answer 請填單一字母，例如 A
5. 多選題 answer 請填字母陣列，例如 ["A", "C"]
6. 情境題與錯題改寫 answer 請填精要解答
"""

    response = structured_llm.invoke(prompt)
    return {"questions": response.model_dump()["questions"]}


def run_quiz_workflow(
    content: str,
    difficulty: DifficultyLevel = "medium",
    preference: str = "",
    numbers: int = 10
):
    if not content or not content.strip():
        return None

    allowed_difficulties = {"very_easy", "easy", "medium", "hard", "very_hard"}
    if difficulty not in allowed_difficulties:
        difficulty = "medium"

    builder = StateGraph(QuizState)

    builder.add_node("summarize_content", summarize_content)
    builder.add_node("plan_spec", plan_spec)
    builder.add_node("generate_questions", generate_questions)

    builder.add_edge(START, "summarize_content")
    builder.add_edge("summarize_content", "plan_spec")
    builder.add_edge("plan_spec", "generate_questions")
    builder.add_edge("generate_questions", END)

    quiz_graph = builder.compile()

    return quiz_graph.invoke({
        "content": content,
        "difficulty": difficulty,
        "preference": preference,
        "numbers": numbers,
        "summary": {},
        "spec": {},
        "questions": []
    })


from pathlib import Path

if __name__ == "__main__":
    content_path = Path(__file__).parent / "doc.md"
    CONTENT = content_path.read_text(encoding="utf-8")

    result = run_quiz_workflow(
        content=CONTENT,
        difficulty="medium",
        preference="考驗一下我熟練不",
        numbers=10
    )

    print("=== Summary ===")
    print(result["summary"] if result else None)

    print("\n=== Spec ===")
    print(result["spec"] if result else None)

    print("\n=== Questions ===")
    print(result["questions"] if result else None)