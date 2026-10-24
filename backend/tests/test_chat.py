import shutil
import sqlite3

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ContentFilterError
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

import agent as chat_agent
import db
import models
import main as chat_router
from main import app

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
        first = returns[-1].content.products[0]
        return ModelResponse(parts=[TextPart(f"Try the **{first.name}** for ${first.price_usd:.0f}!")])

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
    assert history[-2] == {"role": "user", "content": "Show me a hoodie", "products": [], "results": []}
    assert history[-1]["results"][0]["product_id"] == "basic-hoodie-big-yale"

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
    assert history[0] == {"role": "user", "content": "What hoodies do you have?", "products": [], "results": []}
    assert history[1]["products"][0]["name"] == "Basic Hoodie Big Yale"
    # The original data's saved product panel (8 hoodies) comes back as page results.
    assert len(history[1]["results"]) == 8
    assert all(r["description"] and r["image_url"].startswith("/media/") for r in history[1]["results"])


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
    import tools

    ctx = Ctx()
    result = tools.search_products(ctx, query="bulldog", max_price=60)
    assert result.total_matches >= 1
    assert all(p.price_usd <= 60 for p in result.products)
    assert set(ctx.deps.seen_products) == {p.product_id for p in result.products}
    assert ctx.deps.known_prices == {p.price_usd for p in result.products}

    xl = tools.search_products(Ctx(), category="hoodies", in_stock_size="xl")
    for p in xl.products:
        stock = {s["size"]: s["quantity"] for s in db.get_product(p.product_id)["inventory"]}
        assert stock["XL"] > 0 and "XL" in p.sizes_in_stock

    none = tools.search_products(Ctx(), query="gym shorts")
    assert none.total_matches == 0 and "fewer or simpler words" in none.note


def test_details_tool_reports_exact_stock():
    import tools

    d = tools.get_product_details(Ctx(), "basic-hoodie-big-yale")
    by_size = {s.size: (s.quantity, s.status) for s in d.stock_by_size}
    assert by_size["XS"] == (15, "in stock")
    assert by_size["XL"] == (2, "only a few left")
    assert d.price == "$68.00" and d.total_in_stock == 60 and d.sold_out is False
    assert isinstance(tools.get_product_details(Ctx(), "made-up-id"), models.LookupProblem)


# --- Accuracy against the database (Problem 6) ---------------------------------

def all_products():
    import tools

    for p in db.list_products():
        yield p, tools.get_product_details(Ctx(), p["product_id"])


def test_every_product_matches_the_database_exactly():
    """Description, price and stock for every size of every product come straight from the database."""
    with sqlite3.connect(f"file:{db.DB_PATH}?mode=ro", uri=True) as conn:
        catalogue = {r[0]: r[1:] for r in conn.execute("SELECT product_id, description, price FROM catalogue")}
        inventory = {}
        for pid, size, qty in conn.execute("SELECT product_id, size, quantity FROM inventory"):
            inventory.setdefault(pid, {})[size] = qty
    checked = 0
    for _, d in all_products():
        description, price = catalogue[d.product_id]
        assert d.description == description
        assert d.price_usd == price and d.price == f"${price:,.2f}"
        assert {s.size: s.quantity for s in d.stock_by_size} == inventory[d.product_id]
        for s in d.stock_by_size:
            expected = "sold out" if s.quantity == 0 else "only a few left" if s.quantity <= 5 else "in stock"
            assert s.status == expected
        assert set(d.sold_out_sizes) == {k for k, v in inventory[d.product_id].items() if v == 0}
        assert set(d.sizes_in_stock) == {k for k, v in inventory[d.product_id].items() if v > 0}
        assert d.total_in_stock == sum(inventory[d.product_id].values())
        checked += 1
    assert checked == 102


def test_search_results_carry_the_same_stock_as_details():
    import tools

    for p in tools.search_products(Ctx(), category="hoodies").products:
        d = tools.get_product_details(Ctx(), p.product_id)
        assert (p.sizes_in_stock, p.sold_out_sizes, p.price, p.description) == (
            d.sizes_in_stock, d.sold_out_sizes, d.price, d.description)


def test_check_size_reports_sold_out_clearly():
    import tools

    # Find a real sold-out size in the database.
    with sqlite3.connect(f"file:{db.DB_PATH}?mode=ro", uri=True) as conn:
        pid, size = conn.execute("SELECT product_id, size FROM inventory WHERE quantity = 0 LIMIT 1").fetchone()
    result = tools.check_size(Ctx(), pid, size)
    assert (result.quantity, result.status) == (0, "sold out")
    assert size not in result.other_sizes_in_stock
    stock = {s["size"]: s["quantity"] for s in db.get_product(pid)["inventory"]}
    assert result.other_sizes_in_stock == [k for k in db.SIZE_ORDER if stock.get(k, 0) > 0 and k != size]

    ok = tools.check_size(Ctx(), "Basic Hoodie Big Yale", "extra large")  # name and size words work
    assert (ok.size, ok.quantity, ok.status, ok.price) == ("XL", 2, "only a few left", "$68.00")


@pytest.mark.parametrize("word,size", [
    ("medium", "M"), ("M", "M"), ("lg", "L"), ("Large", "L"), ("x-large", "XL"),
    ("2XL", "XXL"), ("xxl", "XXL"), ("Extra Small", "XS"), ("small", "S"),
])
def test_size_words_are_understood(word, size):
    import tools

    assert tools.normalize_size(word) == size
    by_word = tools.search_products(Ctx(), category="crewnecks", in_stock_size=word)
    by_code = tools.search_products(Ctx(), category="crewnecks", in_stock_size=size)
    assert [p.product_id for p in by_word.products] == [p.product_id for p in by_code.products]


def test_unknown_size_and_product_are_reported_not_guessed():
    import tools

    assert "isn't a size we carry" in tools.check_size(Ctx(), "basic-hoodie-big-yale", "XXXL").error
    assert "isn't a size we carry" in tools.search_products(Ctx(), in_stock_size="huge").error
    assert "No product called" in tools.check_size(Ctx(), "Imaginary Sweater", "M").error


def test_product_sold_out_in_every_size_is_flagged():
    import tools

    p = db.get_product("basic-hoodie-big-yale")
    fields = tools._summary_fields(p, [{"size": s, "quantity": 0} for s in db.SIZE_ORDER])
    assert fields["sold_out"] is True and fields["sizes_in_stock"] == [] and fields["total_in_stock"] == 0


# --- The price check -------------------------------------------------------------

class PriceClaude:
    """Looks up a hoodie, then answers with the given replies in turn (to test the price check)."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.retry_messages = []

    def __call__(self, messages, info):
        from pydantic_ai.messages import UserPromptPart

        parts = [p for m in messages for p in getattr(m, "parts", [])]
        # Corrections from the price check arrive as automated feedback messages.
        self.retry_messages = [
            str(p.content) for p in parts if isinstance(p, UserPromptPart) and "<retry_feedback>" in str(p.content)
        ]
        if not any(isinstance(p, ToolReturnPart) for p in parts):
            return ModelResponse(parts=[ToolCallPart("check_size", {"product": "basic-hoodie-big-yale", "size": "M"})])
        reply = self.replies[min(len(self.retry_messages), len(self.replies) - 1)]
        return ModelResponse(parts=[TextPart(reply)])


def test_made_up_price_is_sent_back_and_corrected(client, monkeypatch):
    claude = PriceClaude(
        "The **Basic Hoodie Big Yale** is $59.99 and in stock in M.",  # invented price
        "The **Basic Hoodie Big Yale** is **$68.00**, and there are only 5 left in M.",
    )
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(claude))
    r = client.post("/api/chat", json={"message": "How much is the big Yale hoodie in medium?"})
    assert r.status_code == 200
    assert r.json()["reply"] == "The **Basic Hoodie Big Yale** is **$68.00**, and there are only 5 left in M."
    assert len(claude.retry_messages) == 1 and "$59.99" in claude.retry_messages[0]


def test_reply_that_keeps_inventing_prices_is_never_shown(client, monkeypatch):
    claude = PriceClaude("It's on sale for $19.99!")
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(claude))
    r = client.post("/api/chat", json={"message": "price?"})
    assert r.status_code == 503
    assert "19.99" not in r.text


def test_customer_amounts_and_simple_totals_are_allowed(client, monkeypatch):
    claude = PriceClaude("Yes, it's under your $70 budget at $68.00. Two would be $136.00.")
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(claude))
    r = client.post("/api/chat", json={"message": "Anything under $70?"})
    assert r.status_code == 200 and claude.retry_messages == []


def test_dollar_amounts_are_parsed():
    assert chat_agent.dollar_amounts("$68, $68.00, $ 32.5 and $1,250.50") == {68.0, 32.5, 1250.5}
    assert chat_agent.dollar_amounts("no prices here, 68 dollars") == set()


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


def test_rejected_key_is_logged_with_a_hint(client, monkeypatch, caplog):
    from pydantic_ai.exceptions import ModelHTTPError

    def reject(messages, info):
        raise ModelHTTPError(401, "claude-opus-5-5", body={"error": "invalid x-api-key"})

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(reject))
    r = client.post("/api/chat", json={"message": "hi"})
    assert r.status_code == 503
    assert "invalid" not in r.text  # no details leak to the customer
    assert "HTTP 401" in caplog.text and "setup_env.py --api-key" in caplog.text


def test_setup_cancel_keeps_key(tmp_path, monkeypatch):
    import setup_env

    def cancel(_):
        raise EOFError

    assert setup_env.ask_api_key("ANTHROPIC_API_KEY=old\n", prompt=cancel) == "ANTHROPIC_API_KEY=old\n"


# --- Products shown on the page (Problem 7) --------------------------------------

class BrowsingClaude:
    """Browses a category with one search, then names two of the results."""

    def __init__(self, category="hoodies", query=""):
        self.args = {"category": category, "query": query}

    def __call__(self, messages, info):
        returns = [p for m in messages for p in getattr(m, "parts", []) if isinstance(p, ToolReturnPart)]
        if not returns:
            return ModelResponse(parts=[ToolCallPart("search_products", self.args)])
        found = returns[-1].content.products
        if not found:
            return ModelResponse(parts=[TextPart("Sorry, I couldn't find anything like that.")])
        second, first = found[1], found[0]
        return ModelResponse(parts=[TextPart(
            f"We have {returns[-1].content.total_matches} styles. Try the **{second.name}** or the **{first.name}**!")])


def test_search_shows_every_match_on_the_page(client, monkeypatch):
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(BrowsingClaude("hoodies")))
    body = client.post("/api/chat", json={"message": "What hoodies do you have?"}).json()
    hoodies = db.search_products("hoodies")
    results = body["results"]

    # The model only reads 8 results, but the page shows every hoodie (up to 24).
    assert len(results) == min(len(hoodies), 24) > 8
    # There are more hoodies than fit, so the reply says how many and links to them all.
    assert len(hoodies) > 24
    assert body["more_results"] == {"total": len(hoodies), "link": "/products?category=hoodies"}
    assert {r["product_id"] for r in results} <= {h["product_id"] for h in hoodies}
    # The two products the reply names come first, in the order it names them.
    assert [r["product_id"] for r in results[:2]] == [hoodies[1]["product_id"], hoodies[0]["product_id"]]
    assert [c["product_id"] for c in body["products"]] == [hoodies[1]["product_id"], hoodies[0]["product_id"]]


def test_page_results_have_everything_a_product_card_needs(client, monkeypatch):
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(BrowsingClaude("quarter-zips")))
    body = client.post("/api/chat", json={"message": "quarter zips?"}).json()
    results = body["results"]
    assert results and body["more_results"] is None  # all quarter-zips fit on the page
    for r in results:
        p = db.get_product(r["product_id"])
        assert r == {
            "product_id": p["product_id"], "name": p["name"], "garment_type": p["garment_type"],
            "price": p["price"], "image_url": p["image_url"], "description": p["description"],
            "sold_out": p["total_stock"] == 0,
        }
        assert client.get(r["image_url"]).status_code == 200  # the image loads


def test_no_search_means_no_page_results(client, monkeypatch):
    def chit_chat(messages, info):
        return ModelResponse(parts=[TextPart("You're welcome! Go Bulldogs!")])

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(chit_chat))
    body = client.post("/api/chat", json={"message": "thanks!"}).json()
    assert body["results"] == [] and body["products"] == []


def test_empty_search_gives_no_page_results(client, monkeypatch):
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(BrowsingClaude(None, "gym shorts")))
    body = client.post("/api/chat", json={"message": "gym shorts?"}).json()
    assert body["results"] == [] and "couldn't find" in body["reply"]


def test_looked_up_product_appears_on_the_page(client, monkeypatch):
    claude = PriceClaude("The **Basic Hoodie Big Yale** is **$68.00**.")
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(claude))
    body = client.post("/api/chat", json={"message": "big yale hoodie in M?"}).json()
    assert [r["product_id"] for r in body["results"]] == ["basic-hoodie-big-yale"]


def test_page_results_are_saved_for_logged_in_customers(client, monkeypatch):
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(BrowsingClaude("crewnecks")))
    client.post("/api/auth/login", json=TEST_LOGIN)
    sent = client.post("/api/chat", json={"message": "crewnecks?"}).json()
    saved = client.get("/api/chat/history").json()[-1]
    assert saved["results"] == sent["results"]
    assert saved["products"] == sent["products"]
