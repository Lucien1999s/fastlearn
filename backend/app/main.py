from __future__ import annotations

from fastapi import FastAPI

from .api import router as api_router


app = FastAPI(
    title="fastlearn Backend",
    version="0.1.0",
    description="Quiz generation backend powered by FastAPI and LangGraph.",
)

app.include_router(api_router, prefix="/api")
