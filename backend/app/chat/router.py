"""Chat API: POST /api/chat sends a message to the assistant, GET /api/chat/history reloads it."""

import json
import logging
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request
from pydantic_ai.exceptions import (
    ContentFilterError,
    ModelAPIError,
    ModelHTTPError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)

from .. import auth, db
from . import agent as chat_agent
from .schemas import MAX_HISTORY, ChatReply, ChatRequest, HistoryEntry, ProductCard

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

DECLINED_REPLY = (
    "Sorry, I can't help with that one. I'm happy to help you find Yale gear, check sizes "
    "and stock, or pick out a gift."
)
TRIED_TOO_HARD_REPLY = (
    "Sorry, I couldn't finish looking that up. Could you try asking in a simpler way, "
    "for example \"navy hoodies under $70\"?"
)

# Simple per-visitor limit to protect the API budget: RATE_LIMIT messages per RATE_WINDOW seconds.
RATE_LIMIT = 20
RATE_WINDOW = 10 * 60
_recent: dict[str, deque[float]] = defaultdict(deque)


def _check_rate_limit(key: str) -> None:
    now = time.monotonic()
    hits = _recent[key]
    while hits and now - hits[0] > RATE_WINDOW:
        hits.popleft()
    if len(hits) >= RATE_LIMIT:
        raise HTTPException(429, "You're sending messages quickly. Please wait a few minutes and try again.")
    hits.append(now)


def _cards(products_json: str | None) -> list[ProductCard]:
    if not products_json:
        return []
    try:
        items = json.loads(products_json)
        return [ProductCard.model_validate(p) for p in items][:8]
    except (ValueError, TypeError):
        return []


@router.post("", response_model=ChatReply)
async def chat(body: ChatRequest, request: Request) -> ChatReply:
    user = auth.current_user(request)
    client = request.client.host if request.client else "unknown"
    _check_rate_limit(f"user:{user['id']}" if user else f"ip:{client}")

    if user:
        history = [(r["role"], r["content"]) for r in db.get_chat_history(user["id"], MAX_HISTORY)]
        first_name = user["first_name"] or user["name"].split(" ")[0]
    else:
        history = [(m.role, m.content) for m in body.history]
        first_name = None

    message = body.message.strip()
    try:
        reply, cards = await chat_agent.run_chat(message, history, first_name)
    except chat_agent.AssistantNotConfigured:
        log.error("Chat is unavailable: ANTHROPIC_API_KEY is not set. Run `python setup_env.py --api-key`.")
        raise HTTPException(503, "The shopping assistant isn't set up yet. Please try again later.")
    except ContentFilterError:
        reply, cards = DECLINED_REPLY, []
    except UsageLimitExceeded:
        reply, cards = TRIED_TOO_HARD_REPLY, []
    except ModelHTTPError as e:
        hint = {
            401: "The API key was rejected; run `python setup_env.py --api-key` again.",
            403: "This API key can't use the model; check CHAT_MODEL and your Anthropic account.",
            404: "Model not found; check CHAT_MODEL.",
            429: "Rate limited or out of credit; check your Anthropic account.",
        }.get(e.status_code, "")
        log.warning("Chat model call failed with HTTP %s. %s", e.status_code, hint)
        raise HTTPException(503, "The assistant is having trouble right now. Please try again in a moment.")
    except (ModelAPIError, UnexpectedModelBehavior) as e:
        log.warning("Chat model call failed: %s", type(e).__name__)
        raise HTTPException(503, "The assistant is having trouble right now. Please try again in a moment.")

    if not reply:
        reply = TRIED_TOO_HARD_REPLY
    if user:
        db.save_chat_exchange(user["id"], message, reply, json.dumps(cards) if cards else None)
    return ChatReply(reply=reply, products=[ProductCard(**c) for c in cards])


@router.get("/history", response_model=list[HistoryEntry])
def history(request: Request) -> list[HistoryEntry]:
    """The logged-in customer's recent messages. Guests have no saved history."""
    user = auth.current_user(request)
    if user is None:
        return []
    return [
        HistoryEntry(role=r["role"], content=r["content"], products=_cards(r["products_json"]))
        for r in db.get_chat_history(user["id"], MAX_HISTORY)
        if r["role"] in ("user", "assistant")
    ]
