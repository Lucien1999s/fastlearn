from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI


def _load_project_dotenv() -> None:
    current = Path(__file__).resolve()

    for parent in current.parents:
        dotenv_path = parent / ".env"
        if dotenv_path.exists():
            load_dotenv(dotenv_path=dotenv_path)
            return

    load_dotenv()


_load_project_dotenv()


@lru_cache(maxsize=1)
def get_llm() -> ChatGoogleGenerativeAI:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GOOGLE_API_KEY. Please set it in your .env file.")

    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        temperature=0,
        google_api_key=api_key,
    )
