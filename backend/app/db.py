from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, create_engine, delete, func, inspect, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import get_database_url, get_session_max_age_seconds, get_superuser_email

MAX_TITLE_LENGTH = 20
DEFAULT_DAILY_QUIZ_LIMIT = 5
DEFAULT_DAILY_RETAKE_LIMIT = 5


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def start_of_current_utc_day() -> datetime:
    now = utcnow()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    google_sub: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    picture_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    plan: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    daily_quiz_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_DAILY_QUIZ_LIMIT)
    daily_retake_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_DAILY_RETAKE_LIMIT)
    learning_profile_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    learning_profile: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )


class QuizRecord(Base):
    __tablename__ = "quiz_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
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
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    quiz_record_id: Mapped[str] = mapped_column(String(36), nullable=False)
    quiz_title: Mapped[str] = mapped_column(String(120), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    numbers: Mapped[int] = mapped_column(Integer, nullable=False)
    total_score: Mapped[float] = mapped_column(Float, nullable=False)
    max_score: Mapped[float] = mapped_column(Float, nullable=False)
    score_result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    error_breakdown: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
    )


class QuizGenerationEvent(Base):
    __tablename__ = "quiz_generation_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    quiz_record_id: Mapped[str] = mapped_column(String(36), nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class QuizRetakeEvent(Base):
    __tablename__ = "quiz_retake_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    quiz_record_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


engine = create_engine(get_database_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_database() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_database_schema()
    _sync_superuser_flag()


def _ensure_database_schema() -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    statements: list[str] = []

    if "quiz_records" in table_names:
        existing_columns = {column["name"] for column in inspector.get_columns("quiz_records")}
        if "user_id" not in existing_columns:
            statements.append("ALTER TABLE quiz_records ADD COLUMN user_id VARCHAR(36)")
        if "submitted_answers" not in existing_columns:
            statements.append("ALTER TABLE quiz_records ADD COLUMN submitted_answers JSONB")
        if "score_result" not in existing_columns:
            statements.append("ALTER TABLE quiz_records ADD COLUMN score_result JSONB")
        if "scored_at" not in existing_columns:
            statements.append("ALTER TABLE quiz_records ADD COLUMN scored_at TIMESTAMP WITH TIME ZONE")
        if "updated_at" not in existing_columns:
            statements.append("ALTER TABLE quiz_records ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()")

    if "quiz_attempts" in table_names:
        existing_attempt_columns = {column["name"] for column in inspector.get_columns("quiz_attempts")}
        if "user_id" not in existing_attempt_columns:
            statements.append("ALTER TABLE quiz_attempts ADD COLUMN user_id VARCHAR(36)")

    if "users" in table_names:
        existing_user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "plan" not in existing_user_columns:
            statements.append("ALTER TABLE users ADD COLUMN plan VARCHAR(20) NOT NULL DEFAULT 'free'")
        if "is_admin" not in existing_user_columns:
            statements.append("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE")
        if "daily_quiz_limit" not in existing_user_columns:
            statements.append(
                f"ALTER TABLE users ADD COLUMN daily_quiz_limit INTEGER NOT NULL DEFAULT {DEFAULT_DAILY_QUIZ_LIMIT}"
            )
        if "daily_retake_limit" not in existing_user_columns:
            statements.append(
                f"ALTER TABLE users ADD COLUMN daily_retake_limit INTEGER NOT NULL DEFAULT {DEFAULT_DAILY_RETAKE_LIMIT}"
            )
        if "learning_profile_enabled" not in existing_user_columns:
            statements.append("ALTER TABLE users ADD COLUMN learning_profile_enabled BOOLEAN NOT NULL DEFAULT TRUE")
        if "learning_profile" not in existing_user_columns:
            statements.append("ALTER TABLE users ADD COLUMN learning_profile JSONB NOT NULL DEFAULT '[]'::jsonb")
        if "last_login_at" not in existing_user_columns:
            statements.append("ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP WITH TIME ZONE")
        if "updated_at" not in existing_user_columns:
            statements.append(
                "ALTER TABLE users ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()"
            )

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _sync_superuser_flag() -> None:
    superuser_email = get_superuser_email()
    if not superuser_email:
        return

    with SessionLocal() as session:
        users = list(session.scalars(select(User)).all())
        changed = False
        for user in users:
            should_be_admin = user.email.lower() == superuser_email or user.is_admin
            if user.email.lower() == superuser_email and not user.is_admin:
                user.is_admin = True
                session.add(user)
                changed = True
        if changed:
            session.commit()


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


def hash_session_token(raw_token: str) -> str:
    return sha256(raw_token.encode("utf-8")).hexdigest()


def upsert_google_user(
    session: Session,
    *,
    google_sub: str,
    email: str,
    name: str,
    picture_url: str | None,
) -> User:
    statement = select(User).where(User.google_sub == google_sub)
    user = session.scalars(statement).first()
    is_superuser = email.strip().lower() == get_superuser_email()

    if user is None:
        user = User(
            google_sub=google_sub,
            email=email,
            name=name,
            picture_url=picture_url,
            is_admin=is_superuser,
            updated_at=utcnow(),
        )
    else:
        user.email = email
        user.name = name
        user.picture_url = picture_url
        if is_superuser:
            user.is_admin = True
        user.updated_at = utcnow()

    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def create_user_session(session: Session, *, user_id: str) -> str:
    raw_token = token_urlsafe(48)
    user = session.get(User, user_id)
    if user is not None:
        user.last_login_at = utcnow()
        session.add(user)
    session_record = UserSession(
        user_id=user_id,
        token_hash=hash_session_token(raw_token),
        expires_at=utcnow() + timedelta(seconds=get_session_max_age_seconds()),
        last_seen_at=utcnow(),
    )
    session.add(session_record)
    session.commit()
    return raw_token


def get_user_by_session_token(session: Session, raw_token: str) -> User | None:
    hashed = hash_session_token(raw_token)
    session_record = session.scalars(
        select(UserSession).where(UserSession.token_hash == hashed)
    ).first()

    if session_record is None:
        return None

    if session_record.expires_at <= utcnow():
        session.delete(session_record)
        session.commit()
        return None

    user = session.get(User, session_record.user_id)
    if user is None:
        session.delete(session_record)
        session.commit()
        return None

    session_record.last_seen_at = utcnow()
    session.add(session_record)
    session.commit()
    return user


def delete_user_session(session: Session, raw_token: str) -> None:
    session_record = session.scalars(
        select(UserSession).where(UserSession.token_hash == hash_session_token(raw_token))
    ).first()
    if session_record is None:
        return

    session.delete(session_record)
    session.commit()


def delete_all_user_sessions(session: Session, user_id: str) -> None:
    session.execute(delete(UserSession).where(UserSession.user_id == user_id))
    session.commit()


def list_quiz_records_for_user(session: Session, user_id: str) -> list[QuizRecord]:
    statement = select(QuizRecord).where(QuizRecord.user_id == user_id).order_by(QuizRecord.updated_at.desc())
    return list(session.scalars(statement).all())


def list_scored_quiz_records_for_user(session: Session, user_id: str) -> list[QuizRecord]:
    statement = (
        select(QuizRecord)
        .where(QuizRecord.user_id == user_id)
        .where(QuizRecord.score_result.is_not(None))
    )
    return list(session.scalars(statement).all())


def list_quiz_attempts_for_user(session: Session, user_id: str) -> list[QuizAttempt]:
    statement = select(QuizAttempt).where(QuizAttempt.user_id == user_id).order_by(QuizAttempt.created_at.asc())
    return list(session.scalars(statement).all())


def count_quiz_generations_today(session: Session, user_id: str) -> int:
    start_of_day = start_of_current_utc_day()
    statement = select(func.count()).select_from(QuizGenerationEvent).where(
        QuizGenerationEvent.user_id == user_id,
        QuizGenerationEvent.created_at >= start_of_day,
    )
    return int(session.scalar(statement) or 0)


def count_quiz_retakes_today(session: Session, user_id: str) -> int:
    start_of_day = start_of_current_utc_day()
    statement = select(func.count()).select_from(QuizRetakeEvent).where(
        QuizRetakeEvent.user_id == user_id,
        QuizRetakeEvent.created_at >= start_of_day,
    )
    return int(session.scalar(statement) or 0)


def record_quiz_generation(session: Session, *, user_id: str, quiz_record_id: str, action: str) -> None:
    session.add(
        QuizGenerationEvent(
            user_id=user_id,
            quiz_record_id=quiz_record_id,
            action=action,
        )
    )
    session.commit()


def record_quiz_retake(session: Session, *, user_id: str, quiz_record_id: str) -> None:
    session.add(
        QuizRetakeEvent(
            user_id=user_id,
            quiz_record_id=quiz_record_id,
        )
    )
    session.commit()


def list_all_users(session: Session) -> list[User]:
    return list(session.scalars(select(User).order_by(User.created_at.asc())).all())


def get_user_by_id(session: Session, user_id: str) -> User | None:
    return session.get(User, user_id)


def count_total_quizzes_for_user(session: Session, user_id: str) -> int:
    statement = select(func.count()).select_from(QuizRecord).where(QuizRecord.user_id == user_id)
    return int(session.scalar(statement) or 0)


def count_total_attempts_for_user(session: Session, user_id: str) -> int:
    statement = select(func.count()).select_from(QuizAttempt).where(QuizAttempt.user_id == user_id)
    return int(session.scalar(statement) or 0)


def update_user_access(
    session: Session,
    user: User,
    *,
    is_admin: bool,
    daily_quiz_limit: int,
    daily_retake_limit: int,
) -> User:
    user.is_admin = is_admin or user.email.lower() == get_superuser_email()
    user.daily_quiz_limit = daily_quiz_limit
    user.daily_retake_limit = daily_retake_limit
    user.updated_at = utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def update_learning_profile_settings(session: Session, user: User, *, enabled: bool) -> User:
    user.learning_profile_enabled = enabled
    user.updated_at = utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def upsert_learning_profile_entry(
    session: Session,
    user: User,
    *,
    domain: str,
    status: str,
    grade: str,
) -> User:
    entries = list(user.learning_profile or [])
    next_entries: list[dict[str, Any]] = []
    updated = False

    for entry in entries:
        if entry.get("domain") == domain:
            next_entries.append({"domain": domain, "status": status, "grade": grade})
            updated = True
        else:
            next_entries.append(entry)

    if not updated:
        next_entries.append({"domain": domain, "status": status, "grade": grade})

    user.learning_profile = next_entries
    user.updated_at = utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def delete_learning_profile_entry(session: Session, user: User, *, domain: str) -> User:
    user.learning_profile = [entry for entry in (user.learning_profile or []) if entry.get("domain") != domain]
    user.updated_at = utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def get_quiz_record_for_user(session: Session, *, user_id: str, quiz_id: str) -> QuizRecord | None:
    statement = select(QuizRecord).where(QuizRecord.id == quiz_id, QuizRecord.user_id == user_id)
    return session.scalars(statement).first()


def create_quiz_record(
    session: Session,
    *,
    user_id: str,
    content: str,
    preference: str,
    difficulty: str,
    numbers: int,
    summary: dict[str, Any],
    spec: dict[str, Any],
    questions: list[dict[str, Any]],
) -> QuizRecord:
    record = QuizRecord(
        user_id=user_id,
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
        updated_at=utcnow(),
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
    record.updated_at = utcnow()

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
    error_breakdown: dict[str, int],
) -> QuizRecord:
    record.submitted_answers = submitted_answers
    record.score_result = score_result
    record.scored_at = utcnow()
    record.updated_at = utcnow()
    session.add(record)
    session.add(
        QuizAttempt(
            user_id=record.user_id,
            quiz_record_id=record.id,
            quiz_title=record.title,
            difficulty=record.difficulty,
            numbers=record.numbers,
            total_score=float(score_result["total_score"]),
            max_score=float(score_result["max_score"]),
            score_result=score_result,
            error_breakdown=error_breakdown,
        )
    )
    session.commit()
    session.refresh(record)
    return record


def update_quiz_title(session: Session, record: QuizRecord, title: str) -> QuizRecord:
    record.title = title.strip()[:MAX_TITLE_LENGTH]
    record.updated_at = utcnow()
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def touch_quiz_record(session: Session, record: QuizRecord) -> QuizRecord:
    record.updated_at = utcnow()
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def delete_quiz_record(session: Session, record: QuizRecord) -> None:
    session.execute(delete(QuizRetakeEvent).where(QuizRetakeEvent.quiz_record_id == record.id))
    session.execute(delete(QuizGenerationEvent).where(QuizGenerationEvent.quiz_record_id == record.id))
    session.execute(delete(QuizAttempt).where(QuizAttempt.quiz_record_id == record.id))
    session.delete(record)
    session.commit()


def clear_user_data(session: Session, user_id: str) -> None:
    session.execute(delete(QuizRetakeEvent).where(QuizRetakeEvent.user_id == user_id))
    session.execute(delete(QuizGenerationEvent).where(QuizGenerationEvent.user_id == user_id))
    session.execute(delete(QuizAttempt).where(QuizAttempt.user_id == user_id))
    session.execute(delete(QuizRecord).where(QuizRecord.user_id == user_id))
    user = session.get(User, user_id)
    if user is not None:
        user.learning_profile = []
        session.add(user)
    session.commit()
