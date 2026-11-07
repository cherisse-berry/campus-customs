"""FastAPI backend for the Lecture 12 Scraper Trap chatbot.

Run (from this folder, venv active):
    uvicorn main:app --port 8012
"""

from __future__ import annotations

import json
import traceback
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from pydantic_ai.messages import ModelMessage

from agent import PAGES, list_pages, run_chat
from config import DEFAULT_MODEL, MODELS, key_is_set

EXPLOITS = Path(__file__).resolve().parent / "exploits.json"

app = FastAPI(title="Froggy Labubu — Scraper Trap")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory chat history per browser session (fine for a classroom demo).
SESSIONS: dict[str, list[ModelMessage]] = {}


class ChatRequest(BaseModel):
    session_id: str
    page: str
    model: str = DEFAULT_MODEL
    message: str


class ResetRequest(BaseModel):
    session_id: str


@app.get("/api/health")
def health():
    return {"ok": True, "portkey_key_set": key_is_set(), "models": MODELS, "pages": list_pages()}


@app.get("/api/pages")
def pages():
    return {"pages": list_pages(), "models": MODELS, "default_model": DEFAULT_MODEL}


@app.get("/api/exploits")
def exploits():
    """The attack catalog shown on the Exploits tab (one entry per page)."""
    catalog = json.loads(EXPLOITS.read_text(encoding="utf-8"))
    known = set(list_pages())
    return {"exploits": [e for e in catalog if e["page"] in known]}


@app.get("/pages/{name}")
def page_file(name: str):
    """Serve a page or PDF so the frontend can show what a human sees."""
    if name not in list_pages():
        raise HTTPException(404, "No such page")
    path = PAGES / name
    if path.suffix.lower() == ".pdf":
        return FileResponse(path, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{name}"'})
    return HTMLResponse(path.read_text(encoding="utf-8"))


@app.post("/api/chat")
async def chat(req: ChatRequest):
    if req.page not in list_pages():
        raise HTTPException(400, f"Unknown page {req.page!r}")
    if req.model not in MODELS:
        raise HTTPException(400, f"Unknown model {req.model!r}")
    if not req.message.strip():
        raise HTTPException(400, "Empty message")
    try:
        payload, history = await run_chat(
            req.message,
            page_name=req.page,
            model_name=req.model,
            history=SESSIONS.get(req.session_id),
        )
    except Exception as exc:  # surface the error in the chat instead of a blank 500
        traceback.print_exc()
        raise HTTPException(502, f"Agent error: {exc}") from exc
    SESSIONS[req.session_id] = history
    return payload


@app.post("/api/reset")
def reset(req: ResetRequest):
    SESSIONS.pop(req.session_id, None)
    return {"ok": True}
