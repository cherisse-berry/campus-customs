"""Campus Customs API: product catalogue, stock, images, customer accounts and chat."""

import json
import logging
import os
import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic_ai.exceptions import (
    ContentFilterError,
    ModelAPIError,
    ModelHTTPError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)

import agent as chat_agent
import audit
import auth
import config  # noqa: F401  (loads .env)
import db
from models import (
    MAX_HISTORY,
    ChatReply,
    ChatRequest,
    HistoryEntry,
    MoreResults,
    ProductCard,
    ProductResult,
    ViewedProduct,
)

log = logging.getLogger(__name__)

app = FastAPI(title="Campus Customs API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(auth.router)

# Serve only the images folder, never the data folder (which holds the database).
app.mount(
    "/media/products",
    StaticFiles(directory=db.IMAGES_DIR, check_dir=False),
    name="product-images",
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "database": db.DB_PATH.exists()}


@app.get("/api/categories")
def categories() -> list[dict]:
    products = db.list_products()
    return [
        {
            "slug": slug,
            "name": name,
            "count": sum(p["category"] == slug for p in products),
        }
        for slug, name, _ in db.CATEGORIES
    ]


@app.get("/api/products")
def products(
    category: str | None = None,
    q: str | None = Query(None, description="Search name, description, colors and tags"),
    sort: Literal["name", "price-asc", "price-desc"] = "name",
    size: str | None = Query(None, description="Only products in stock in this size (XS-XXL)"),
) -> list[dict]:
    items = db.search_products(category, q, sort)
    stock = db.stock_by_product()
    for p in items:
        p["stock"] = stock.get(p["product_id"], [])  # quantity per size, for availability on cards
    if size:
        wanted = size.strip().upper()
        items = [p for p in items if any(s["size"] == wanted and s["quantity"] > 0 for s in p["stock"])]
    return items


@app.get("/api/products/{product_id}")
def product_detail(product_id: str) -> dict:
    product = db.get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


# --- Chat ----------------------------------------------------------------------

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


def _saved_viewing(products_json: str | None) -> dict | None:
    """The product page saved with a customer message, if any."""
    try:
        data = json.loads(products_json) if products_json else None
        return ViewedProduct.model_validate(data).model_dump() if isinstance(data, dict) else None
    except ValueError:
        return None


def _saved_results(products_json: str | None) -> list[ProductResult]:
    """The page results saved with an assistant message (older rows hold full product objects)."""
    if not products_json:
        return []
    try:
        items = json.loads(products_json)
        return [
            ProductResult.model_validate({**p, "sold_out": p.get("sold_out", p.get("total_stock", 1) == 0)})
            for p in items
        ]
    except (ValueError, TypeError, AttributeError):
        return []


@app.post("/api/chat", response_model=ChatReply)
async def chat(body: ChatRequest, request: Request) -> ChatReply:
    user = auth.current_user(request)
    client = request.client.host if request.client else "unknown"
    try:
        _check_rate_limit(f"user:{user['id']}" if user else f"ip:{client}")
    except HTTPException:
        audit.record_rate_limited(logged_in=user is not None)
        raise

    if user:
        # A logged-in customer: who they are comes from their session, and the conversation
        # (including which product page each message was sent from) from the database.
        customer = {
            "first_name": user["first_name"] or user["name"].split(" ")[0],
            "name": user["name"],
            "email": user["email"],
        }
        history = []
        for r in db.get_chat_history(user["id"], MAX_HISTORY):
            viewed = _saved_viewing(r["products_json"]) if r["role"] == "user" else None
            history.append((r["role"], chat_agent.with_viewing_note(r["content"], viewed)))
    else:
        # A guest: nothing is saved, so the browser sends the conversation so far.
        customer = None
        history = [
            (m.role, chat_agent.with_viewing_note(
                audit.remove_sensitive(m.content)[0] if m.role == "user" else m.content,
                chat_agent.viewing_info(m.viewing_product_id) if m.role == "user" else None))
            for m in body.history
        ]

    viewing = chat_agent.viewing_info(body.viewing_product_id)
    # Card numbers, Social Security numbers and passwords never reach the model or the database.
    message, removed = audit.remove_sensitive(body.message.strip())
    try:
        turn = await chat_agent.run_chat(message, history, customer, viewing, sensitive_removed=removed)
    except chat_agent.AssistantNotConfigured:
        log.error("Chat is unavailable: ANTHROPIC_API_KEY is not set. Run `python setup_env.py --api-key`.")
        raise HTTPException(503, "The shopping assistant isn't set up yet. Please try again later.")
    except ContentFilterError:
        turn = chat_agent.ChatTurn(DECLINED_REPLY, [], [], None, [])
    except UsageLimitExceeded:
        turn = chat_agent.ChatTurn(TRIED_TOO_HARD_REPLY, [], [], None, [])
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

    reply = turn.reply or TRIED_TOO_HARD_REPLY
    if user:
        db.save_chat_exchange(
            user["id"], message, reply,
            products_json=json.dumps(turn.results) if turn.results else None,
            viewing_json=json.dumps({"product_id": viewing["product_id"], "name": viewing["name"]}) if viewing else None,
        )
    return ChatReply(
        reply=reply,
        products=[ProductCard(**c) for c in turn.cards],
        results=[ProductResult(**r) for r in turn.results],
        more_results=MoreResults(**turn.more) if turn.more else None,
        suggestions=turn.suggestions,
    )


@app.get("/api/chat/history", response_model=list[HistoryEntry])
def chat_history(request: Request) -> list[HistoryEntry]:
    """The logged-in customer's recent messages. Guests have no saved history."""
    user = auth.current_user(request)
    if user is None:
        return []
    entries = []
    for r in db.get_chat_history(user["id"], MAX_HISTORY):
        if r["role"] not in ("user", "assistant"):
            continue
        if r["role"] == "user":
            viewed = _saved_viewing(r["products_json"])
            entries.append(HistoryEntry(
                role="user", content=r["content"], viewing=ViewedProduct(**viewed) if viewed else None))
            continue
        results = _saved_results(r["products_json"])
        found = {p.product_id: p.model_dump() for p in results}
        entries.append(HistoryEntry(
            role=r["role"],
            content=r["content"],
            products=[ProductCard(**c) for c in chat_agent.cards_for_reply(r["content"], found)],
            results=results,
        ))
    return entries
