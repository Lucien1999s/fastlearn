from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import DateTime, Integer, String, Text, create_engine, func, inspect, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import get_database_url

MAX_TITLE_LENGTH = 15


class Base(DeclarativeBase):
    pass


class QuizRecord(Base):
    __tablename__ = "quiz_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    preference: Mapped[str] = mapped_column(Text, nullable=False, default="")
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    numbers: Mapped[int] = mapped_column(Integer, nullable=False)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    questions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    submitted_answers: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    score_result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    scored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


engine = create_engine(get_database_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_database() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_quiz_record_schema()


def _ensure_quiz_record_schema() -> None:
    inspector = inspect(engine)
    if "quiz_records" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("quiz_records")}
    statements: list[str] = []

    if "submitted_answers" not in existing_columns:
        statements.append("ALTER TABLE quiz_records ADD COLUMN submitted_answers JSONB")

    if "score_result" not in existing_columns:
        statements.append("ALTER TABLE quiz_records ADD COLUMN score_result JSONB")

    if "scored_at" not in existing_columns:
        statements.append("ALTER TABLE quiz_records ADD COLUMN scored_at TIMESTAMP WITH TIME ZONE")

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def get_db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def build_quiz_title(content: str) -> str:
    for line in content.splitlines():
        normalized = " ".join(line.split())
        if normalized:
            return normalized[:MAX_TITLE_LENGTH]

    compact = " ".join(content.split())
    return compact[:MAX_TITLE_LENGTH] if compact else "Untitled Quiz"


def create_quiz_record(
    session: Session,
    *,
    content: str,
    preference: str,
    difficulty: str,
    numbers: int,
    summary: dict[str, Any],
    spec: dict[str, Any],
    questions: list[dict[str, Any]],
) -> QuizRecord:
    record = QuizRecord(
        title=build_quiz_title(content),
        content=content,
        preference=preference,
        difficulty=difficulty,
        numbers=numbers,
        summary=summary,
        spec=spec,
        questions=questions,
        submitted_answers=None,
        score_result=None,
        scored_at=None,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def update_quiz_record(
    session: Session,
    record: QuizRecord,
    *,
    content: str,
    preference: str,
    difficulty: str,
    numbers: int,
    summary: dict[str, Any],
    spec: dict[str, Any],
    questions: list[dict[str, Any]],
) -> QuizRecord:
    auto_generated_title = record.title == build_quiz_title(record.content)

    record.content = content
    record.preference = preference
    record.difficulty = difficulty
    record.numbers = numbers
    record.summary = summary
    record.spec = spec
    record.questions = questions
    record.submitted_answers = None
    record.score_result = None
    record.scored_at = None

    if auto_generated_title:
        record.title = build_quiz_title(content)

    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def save_quiz_score(
    session: Session,
    record: QuizRecord,
    *,
    submitted_answers: dict[str, Any],
    score_result: dict[str, Any],
) -> QuizRecord:
    record.submitted_answers = submitted_answers
    record.score_result = score_result
    record.scored_at = datetime.now(timezone.utc)
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def update_quiz_title(session: Session, record: QuizRecord, title: str) -> QuizRecord:
    record.title = title.strip()[:MAX_TITLE_LENGTH]
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def delete_quiz_record(session: Session, record: QuizRecord) -> None:
    session.delete(record)
    session.commit()
