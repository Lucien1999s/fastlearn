from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


def load_project_dotenv() -> None:
    current = Path(__file__).resolve()

    for parent in current.parents:
        dotenv_path = parent / ".env"
        if dotenv_path.exists():
            load_dotenv(dotenv_path=dotenv_path)
            return

    load_dotenv()


load_project_dotenv()


@lru_cache(maxsize=1)
def get_google_api_key() -> str:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GOOGLE_API_KEY. Please set it in your .env file.")
    return api_key


@lru_cache(maxsize=1)
def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("Missing DATABASE_URL. Please set it in your .env file.")
    return database_url


@lru_cache(maxsize=1)
def get_cors_origins() -> list[str]:
    raw_value = os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:5173,http://localhost:5173",
    )
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]
