import shutil
import sqlite3

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ContentFilterError
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app import db
from app.chat import agent as chat_agent
from app.chat import router as chat_router
from app.main import app

pytestmark = pytest.mark.skipif(
    not db.DB_PATH.exists(), reason="database not present (it is not committed to git)"
)

TEST_LOGIN = {"email": "test@campuscustoms.yale.edu", "password": "password"}


class ScriptedClaude:
    """Stands in for Claude: searches for hoodies, then answers using what the tool returned."""

    def __init__(self):
        self.calls: list[list[ModelMessage]] = []

    def __call__(self, messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        self.calls.append(messages)
        returns = [p for m in messages for p in getattr(m, "parts", []) if isinstance(p, ToolReturnPart)]
        if not returns:
            return ModelResponse(parts=[ToolCallPart("search_products", {"query": "big yale", "category": "hoodies"})])
        first = returns[-1].content["products"][0]
        return ModelResponse(parts=[TextPart(f"Try the **{first['name']}** for ${first['price_usd']:.0f}!")])

    def prompt_text(self, call=0) -> str:
        return repr(self.calls[call])


@pytest.fixture
def claude(monkeypatch):
    scripted = ScriptedClaude()
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(scripted))
    return scripted


@pytest.fixture
def client(tmp_path, monkeypatch):
    copy = tmp_path / "campus_customs.db"
    shutil.copy(db.DB_PATH, copy)
    monkeypatch.setattr(db, "DB_PATH", copy)
    monkeypatch.setattr(chat_router, "_recent", chat_router.defaultdict(chat_router.deque))
    return TestClient(app)


def chat_rows(user_id):
    with sqlite3.connect(db.DB_PATH) as conn:
        return conn.execute(
            "SELECT role, content, products_json FROM chat_messages WHERE user_id = ? ORDER BY id", (user_id,)
        ).fetchall()


# --- The agent and tools -------------------------------------------------------

def test_guest_message_reaches_agent_and_uses_tools(client, claude):
    r = client.post("/api/chat", json={"message": "Do you have hoodies?"})
    assert r.status_code == 200
    body = r.json()
    assert body["reply"] == "Try the **Basic Hoodie Big Yale** for $68!"
    assert body["products"] == [{
        "product_id": "basic-hoodie-big-yale", "name": "Basic Hoodie Big Yale",
        "price": 68.0, "image_url": "/media/products/basic-hoodie-big-yale.jpg",
    }]
    assert len(claude.calls) == 2  # asked a tool, then answered
    assert "Do you have hoodies?" in claude.prompt_text()


def test_instructions_include_prompt_file_and_customer(client, claude):
    client.post("/api/chat", json={"message": "hi"})
    sent = claude.prompt_text()
    assert "Campus Customs shopping assistant" in sent
    assert "Safety and boundaries" in sent
    assert "browsing as a guest" in sent

    client.post("/api/auth/login", json=TEST_LOGIN)
    client.post("/api/chat", json={"message": "hi again"})
    assert "Their first name is Test" in claude.prompt_text(-1)


def test_guest_history_is_sent_to_the_model(client, claude):
    history = [
        {"role": "assistant", "content": "Hi! I'm the Campus Customs assistant."},  # greeting, skipped
        {"role": "user", "content": "I need a gift for my dad"},
        {"role": "assistant", "content": "Lovely! What does he like to wear?"},
    ]
    client.post("/api/chat", json={"message": "He likes hoodies", "history": history})
    sent = claude.prompt_text()
    assert "I need a gift for my dad" in sent and "What does he like to wear?" in sent
    assert "Campus Customs assistant." not in sent


def test_logged_in_chat_is_saved_and_reloaded(client, claude):
    client.post("/api/auth/login", json=TEST_LOGIN)
    before = len(chat_rows(1))
    client.post("/api/chat", json={"message": "Show me a hoodie"})
    rows = chat_rows(1)
    assert len(rows) == before + 2
    assert rows[-2][:2] == ("user", "Show me a hoodie")
    assert rows[-1][0] == "assistant" and "Basic Hoodie Big Yale" in rows[-1][2]

    history = client.get("/api/chat/history").json()
    assert history[-1]["products"][0]["product_id"] == "basic-hoodie-big-yale"
    assert history[-2] == {"role": "user", "content": "Show me a hoodie", "products": []}

    # The next message carries the saved history, and browser-sent history is ignored.
    client.post("/api/chat", json={"message": "In XL?", "history": [{"role": "user", "content": "FAKE"}]})
    sent = claude.prompt_text(-1)
    assert "Show me a hoodie" in sent and "FAKE" not in sent


def test_guests_have_no_saved_history(client, claude):
    client.post("/api/chat", json={"message": "hello"})
    assert client.get("/api/chat/history").json() == []


def test_existing_chat_rows_load_with_product_cards(client):
    client.post("/api/auth/login", json=TEST_LOGIN)
    history = client.get("/api/chat/history").json()
    assert history[0] == {"role": "user", "content": "What hoodies do you have?", "products": []}
    assert history[1]["products"][0]["name"] == "Basic Hoodie Big Yale"


# --- Errors and limits ----------------------------------------------------------

def test_missing_api_key_gives_friendly_503(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = client.post("/api/chat", json={"message": "hi"})
    assert r.status_code == 503
    assert "isn't set up yet" in r.json()["detail"]


def test_refusal_becomes_polite_reply(client, monkeypatch):
    def refuse(messages, info):
        raise ContentFilterError("refused", body="{}")

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(refuse))
    r = client.post("/api/chat", json={"message": "something inappropriate"})
    assert r.status_code == 200
    assert r.json()["reply"] == chat_router.DECLINED_REPLY


def test_runaway_tool_loop_is_stopped(client, monkeypatch):
    def loop(messages, info):
        return ModelResponse(parts=[ToolCallPart("list_categories", {})])

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(loop))
    r = client.post("/api/chat", json={"message": "hi"})
    assert r.status_code == 200
    assert r.json()["reply"] == chat_router.TRIED_TOO_HARD_REPLY


@pytest.mark.parametrize("message", ["", "x" * 1001])
def test_message_length_is_validated(client, claude, message):
    assert client.post("/api/chat", json={"message": message}).status_code == 422


def test_rate_limit(client, claude, monkeypatch):
    monkeypatch.setattr(chat_router, "RATE_LIMIT", 2)
    assert client.post("/api/chat", json={"message": "1"}).status_code == 200
    assert client.post("/api/chat", json={"message": "2"}).status_code == 200
    assert client.post("/api/chat", json={"message": "3"}).status_code == 429


# --- Tools and helpers ----------------------------------------------------------

class Ctx:
    def __init__(self):
        self.deps = chat_agent.ChatDeps()


def test_search_tool_filters_and_records_products():
    from app.chat import tools

    ctx = Ctx()
    result = tools.search_products(ctx, query="bulldog", max_price=60)
    assert result["total_matches"] >= 1
    assert all(p["price_usd"] <= 60 for p in result["products"])
    assert set(ctx.deps.seen_products) == {p["product_id"] for p in result["products"]}

    xl = tools.search_products(Ctx(), category="hoodies", in_stock_size="xl")
    for p in xl["products"]:
        stock = {s["size"]: s["quantity"] for s in db.get_product(p["product_id"])["inventory"]}
        assert stock["XL"] > 0

    assert tools.search_products(Ctx(), query="gym shorts")["total_matches"] == 0


def test_details_tool_reports_stock_labels():
    from app.chat import tools

    d = tools.get_product_details(Ctx(), "basic-hoodie-big-yale")
    assert d["stock_by_size"]["XS"] == "15 in stock"
    assert d["stock_by_size"]["XL"] == "only 2 left"
    assert "error" in tools.get_product_details(Ctx(), "made-up-id")


def test_cards_only_for_products_named_in_reply():
    seen = {
        "a": {"product_id": "a", "name": "Yale Dad Hoodie", "price": 68, "image_url": "/a.jpg"},
        "b": {"product_id": "b", "name": "Yale Mom Hoodie", "price": 68, "image_url": "/b.jpg"},
        "c": {"product_id": "c", "name": "Yale Dad T Shirt", "price": 32, "image_url": "/c.jpg"},
    }
    cards = chat_agent.cards_for_reply("The **Yale Mom Hoodie** or the yale dad hoodie.", seen)
    assert [c["product_id"] for c in cards] == ["b", "a"]


def test_model_settings_use_low_effort_and_fallback():
    model = chat_agent._anthropic_model("claude-opus-5-5", "sk-test-not-real")
    assert model.model_name == "claude-opus-5-5"
    assert model.settings["anthropic_effort"] == "low"
    assert model.settings["extra_body"] == {"fallbacks": "default"}
    assert model.settings["anthropic_betas"] == ["server-side-fallback-2026-07-01"]
    assert "extra_body" not in chat_agent._anthropic_model("claude-haiku-5-5", "sk-test-not-real").settings


def test_api_key_only_goes_to_anthropic(monkeypatch):
    # Claude Code and similar tools set ANTHROPIC_BASE_URL for their own use; it must be ignored.
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://some-other-proxy.example")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-not-real")
    monkeypatch.delenv("CHAT_ANTHROPIC_BASE_URL", raising=False)
    model = chat_agent.get_model()
    assert model.base_url.rstrip("/") == "https://api.anthropic.com"
