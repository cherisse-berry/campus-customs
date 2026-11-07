"""Harry Potter multi-agent API — routes only.

Run from this directory:
  uvicorn main:app --reload --host 127.0.0.1 --port 8000

Frontend (Vite): http://127.0.0.1:5173
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agents.boss import run_boss_chat, run_boss_chat_stream
from agents.config import BOSS_NAME, MODEL_NAME
from models import BOOK_CATALOG, ChatRequest, ChatResponse
from retrieval import list_books

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env")

BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

app = FastAPI(title="Harry Potter Multi-Agent", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    db = ROOT / "data" / "harrypotter.db"
    key_set = bool(os.getenv("PORTKEY_API_KEY", "").strip())
    books = []
    try:
        books = list_books()
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "boss": BOSS_NAME,
            "model": MODEL_NAME,
            "portkey_key_set": key_set,
        }
    return {
        "ok": True,
        "boss": BOSS_NAME,
        "model": MODEL_NAME,
        "db": db.name,
        "books": len(books),
        "portkey_key_set": key_set,
    }


@app.get("/api/roster")
def roster():
    """Boss + specialist roster for the frontend."""
    db_books = {b["book_number"]: b for b in list_books()}
    specialists = []
    for b in BOOK_CATALOG:
        meta = db_books.get(b["book_number"], {})
        specialists.append(
            {
                **b,
                "page_count": meta.get("page_count"),
                "token_count": meta.get("token_count"),
            }
        )
    return {"boss": BOSS_NAME, "specialists": specialists}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(body: ChatRequest):
    result = await run_boss_chat(body.message)
    return ChatResponse(**result)


@app.post("/api/chat/stream")
async def chat_stream(body: ChatRequest):
    """SSE stream of progress events + final payload."""

    async def gen():
        async for event in run_boss_chat_stream(body.message):
            payload = json.dumps(event, ensure_ascii=False)
            yield f"event: {event['type']}\ndata: {payload}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=BACKEND_PORT, reload=False)
