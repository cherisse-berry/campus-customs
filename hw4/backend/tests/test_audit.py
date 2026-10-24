"""The chatbot audit trail (audit.py) and the removal of sensitive details from messages."""

import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic_ai.exceptions import ContentFilterError, ModelHTTPError
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

import agent as chat_agent
import audit
import db
import main as chat_router
from tests.test_chat import TEST_LOGIN, PriceClaude, chat_rows, claude, client  # noqa: F401  (fixtures)

pytestmark = pytest.mark.skipif(
    not db.DB_PATH.exists(), reason="database not present (it is not committed to git)"
)

CARD = "4111 1111 1111 1111"  # a standard test card number (passes the Luhn check)


def records(path):
    """The trail must always be one valid JSON array."""
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    assert isinstance(data, list)
    return data


# --- What a run records -------------------------------------------------------------

def test_a_chat_run_is_recorded_with_tools_results_and_stop_reason(client, claude, audit_log):
    r = client.post("/api/chat", json={"message": "Show me a hoodie", "viewing_product_id": "yale-mom-hoodie"})
    assert r.status_code == 200
    [rec] = records(audit_log)
    assert rec["event"] == "chat_run" and len(rec["run_id"]) == 12 and rec["time"].endswith("Z")
    assert rec["customer"] == "guest"
    assert rec["viewing_product"] == "yale-mom-hoodie"
    assert rec["model"] == chat_agent.model_name()
    assert rec["message_chars"] == len("Show me a hoodie") and rec["history_messages"] == 0
    [step] = rec["tools"]
    assert step["tool"] == "search_products"
    assert step["args"] == {"query": "big yale", "category": "hoodies"}
    assert step["result"].startswith("1 matches, 1 shown to the model: basic-hoodie-big-yale")
    assert rec["stop"] == {"reason": "answered", "detail": "stop"}
    assert rec["reply"] == {"chars": len(r.json()["reply"]), "product_cards": 1, "page_results": 1, "suggestions": 0}
    assert rec["model_calls"] == 2 and rec["price_check_corrections"] == 0
    assert rec["served_by"] and all(m.startswith("function") for m in rec["served_by"])  # the test stand-in
    assert set(rec["tokens"]) == {"input", "output"} and rec["duration_ms"] >= 0


def test_tool_results_summarize_prices_and_stock_from_the_database(client, monkeypatch, audit_log):
    def model(messages, info):
        if len(messages) == 1:
            return ModelResponse(parts=[
                ToolCallPart("check_size", {"product": "champion-reverse-weave-hoodie-1", "size": "XL"}, tool_call_id="a"),
                ToolCallPart("get_product_details", {"product": "basic-hoodie-big-yale"}, tool_call_id="b"),
                ToolCallPart("get_product_details", {"product": "no-such-thing"}, tool_call_id="c"),
                ToolCallPart("list_categories", {}, tool_call_id="d"),
            ])
        return ModelResponse(parts=[TextPart("Done.")])

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(model))
    client.post("/api/chat", json={"message": "check"})
    results = [s["result"] for s in records(audit_log)[0]["tools"]]
    hoodie = db.get_product("basic-hoodie-big-yale")
    sold_out = [s["size"] for s in hoodie["inventory"] if s["quantity"] == 0]
    assert results[0] == "champion-reverse-weave-hoodie-1 XL: sold out (0), $68.00"
    assert results[1] == (f"basic-hoodie-big-yale: $68.00, {hoodie['total_stock']} in stock, "
                          f"sold out: {', '.join(sold_out) or 'none'}")
    assert results[2].startswith("not found:")
    assert results[3] == "6 categories"


def test_default_location_is_output_audit_trail_json(monkeypatch):
    import importlib

    monkeypatch.delenv("CHAT_AUDIT_LOG", raising=False)
    fresh = importlib.reload(audit)
    try:
        assert fresh.AUDIT_LOG == Path(__file__).resolve().parents[2] / "output" / "audit_trail.json"
    finally:
        importlib.reload(audit)  # the autouse fixture's patch is undone by monkeypatch afterwards


def test_trail_is_a_json_array_with_one_record_per_line(client, claude, audit_log):
    client.post("/api/chat", json={"message": "one"})
    client.post("/api/chat", json={"message": "two"})
    text = audit_log.read_text()
    lines = text.splitlines()
    assert lines[0] == "[" and lines[-1] == "]" and text.endswith("]\n")
    assert len(lines) == 4 and lines[1].endswith(",") and not lines[2].endswith(",")
    assert [json.loads(line.rstrip(",")) for line in lines[1:-1]] == records(audit_log)


def test_every_run_is_appended_and_earlier_records_are_kept_byte_for_byte(client, claude, audit_log):
    audit_log.parent.mkdir(parents=True)
    earlier = '[\n  {"event": "chat_run", "run_id": "earlier", "note": "written by hand, kept exactly"}\n]\n'
    audit_log.write_text(earlier)
    client.post("/api/chat", json={"message": "one"})
    after_one = audit_log.read_text()
    client.post("/api/chat", json={"message": "two"})
    after_two = audit_log.read_text()
    # Only the closing bracket is ever replaced: everything before it stays exactly as it was.
    assert after_one.startswith(earlier.rstrip()[:-1].rstrip())
    assert after_two.startswith(after_one.rstrip()[:-1].rstrip())
    recs = records(audit_log)
    assert recs[0]["run_id"] == "earlier"
    assert len(recs) == 3 and len({r["run_id"] for r in recs}) == 3


def test_an_empty_array_or_empty_file_is_continued(client, claude, audit_log):
    audit_log.parent.mkdir(parents=True)
    for start in ("[]", "", "[\n]\n"):
        audit_log.write_text(start)
        client.post("/api/chat", json={"message": "hi"})
        assert len(records(audit_log)) == 1


def test_an_unreadable_trail_is_set_aside_never_deleted(client, claude, audit_log):
    audit_log.parent.mkdir(parents=True)
    audit_log.write_text('[{"run_id": "half-written"')
    client.post("/api/chat", json={"message": "hi"})
    [kept] = list(audit_log.parent.glob("audit_trail.unreadable-*.json"))
    assert kept.read_text() == '[{"run_id": "half-written"'
    assert len(records(audit_log)) == 1


def test_records_from_the_old_log_file_are_moved_in(client, claude, audit_log):
    legacy = audit.LEGACY_LOG
    legacy.parent.mkdir(parents=True)
    legacy.write_text('{"event":"chat_run","run_id":"old1"}\n{"event":"chat_run","run_id":"old2"}\n')
    client.post("/api/chat", json={"message": "hi"})
    client.post("/api/chat", json={"message": "again"})
    assert [r["run_id"] for r in records(audit_log)][:2] == ["old1", "old2"]
    assert len(records(audit_log)) == 4  # imported once, not twice
    assert not legacy.exists() and legacy.with_name("chat_audit.jsonl.imported").exists()


def test_simultaneous_writes_all_land(audit_log):
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda i: audit.write({"event": "chat_run", "run_id": f"r{i}"}), range(60)))
    assert sorted(r["run_id"] for r in records(audit_log)) == sorted(f"r{i}" for i in range(60))


def test_audit_file_is_private_to_its_owner(client, claude, audit_log):
    client.post("/api/chat", json={"message": "hi"})
    assert stat.S_IMODE(os.stat(audit_log).st_mode) == 0o600


def test_a_broken_audit_log_never_breaks_the_chat(client, claude, monkeypatch, tmp_path):
    monkeypatch.setattr(audit, "AUDIT_LOG", tmp_path)  # a folder, so writing fails
    r = client.post("/api/chat", json={"message": "Show me a hoodie"})
    assert r.status_code == 200 and "Basic Hoodie Big Yale" in r.json()["reply"]


# --- Why a run stopped ---------------------------------------------------------------

def test_missing_key_is_recorded(client, monkeypatch, audit_log):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert client.post("/api/chat", json={"message": "hi"}).status_code == 503
    [rec] = records(audit_log)
    assert rec["stop"]["reason"] == "not_configured" and rec["tools"] == [] and rec["model_calls"] == 0


def test_refusal_is_recorded(client, monkeypatch, audit_log):
    def refuse(messages, info):
        raise ContentFilterError("refused", body="{}")

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(refuse))
    client.post("/api/chat", json={"message": "something inappropriate"})
    assert records(audit_log)[0]["stop"]["reason"] == "refused"


def test_runaway_tool_loop_is_recorded_as_usage_limit(client, monkeypatch, audit_log):
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(
        lambda m, i: ModelResponse(parts=[ToolCallPart("list_categories", {})])))
    client.post("/api/chat", json={"message": "hi"})
    rec = records(audit_log)[0]
    assert rec["stop"]["reason"] == "usage_limit"
    assert rec["model_calls"] == chat_agent.USAGE_LIMITS.request_limit
    assert all(s["tool"] == "list_categories" for s in rec["tools"]) and len(rec["tools"]) >= 7


def test_model_http_error_is_recorded_without_details(client, monkeypatch, audit_log):
    def fail(messages, info):
        raise ModelHTTPError(401, "claude-opus-5-5", body={"error": "invalid x-api-key sk-ant-secret"})

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(fail))
    assert client.post("/api/chat", json={"message": "hi"}).status_code == 503
    assert records(audit_log)[0]["stop"] == {"reason": "model_error", "detail": "HTTP 401"}
    assert "sk-ant" not in audit_log.read_text()


def test_price_corrections_are_counted(client, monkeypatch, audit_log):
    claude = PriceClaude(
        "The **Basic Hoodie Big Yale** is $59.99 and in stock in M.",
        "The **Basic Hoodie Big Yale** is **$68.00**, and there are only 5 left in M.",
    )
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(claude))
    client.post("/api/chat", json={"message": "How much is the big Yale hoodie in medium?"})
    rec = records(audit_log)[0]
    assert rec["price_check_corrections"] == 1 and rec["stop"]["reason"] == "answered"


def test_reply_that_keeps_inventing_prices_is_recorded(client, monkeypatch, audit_log):
    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(PriceClaude("It's on sale for $19.99!")))
    client.post("/api/chat", json={"message": "price?"})
    rec = records(audit_log)[0]
    assert rec["stop"]["reason"] == "unexpected_model_behavior"
    assert rec["price_check_corrections"] == 2


def test_rejected_tool_arguments_are_recorded(client, monkeypatch, audit_log):
    def model(messages, info):
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart("suggest_replies", {"options": ["only one"]})])
        return ModelResponse(parts=[TextPart("What size?")])

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(model))
    client.post("/api/chat", json={"message": "a gift"})
    step = records(audit_log)[0]["tools"][0]
    assert step["tool"] == "suggest_replies" and step["result"].startswith("rejected, asked to retry:")


def test_rate_limited_messages_are_recorded(client, claude, monkeypatch, audit_log):
    monkeypatch.setattr(chat_router, "RATE_LIMIT", 1)
    client.post("/api/chat", json={"message": "1"})
    assert client.post("/api/chat", json={"message": "2"}).status_code == 429
    blocked = records(audit_log)[-1]
    assert blocked["event"] == "chat_blocked" and blocked["stop"]["reason"] == "rate_limited"
    assert blocked["customer"] == "guest"


# --- Privacy ------------------------------------------------------------------------

def test_no_customer_details_are_written(client, claude, audit_log):
    client.post("/api/auth/login", json=TEST_LOGIN)
    secret = "My email is ada.lovelace@example.com and my number is 203-555-0142, show me a hoodie"
    client.post("/api/chat", json={"message": secret})
    text = audit_log.read_text()
    rec = records(audit_log)[0]
    assert rec["customer"] == "logged_in"
    for private in ("Test User", "test@campuscustoms", "ada.lovelace", "555-0142", "show me a hoodie",
                    '"user_id"', "testclient", "127.0.0.1"):
        assert private.lower() not in text.lower()


def test_card_numbers_never_reach_the_model_the_database_or_the_log(client, claude, audit_log):
    client.post("/api/auth/login", json=TEST_LOGIN)
    client.post("/api/chat", json={"message": f"Can I pay with {CARD}? Show me a hoodie"})
    assert "4111" not in claude.prompt_text(-1)
    assert "[card number removed]" in claude.prompt_text(-1)
    saved = chat_rows(1)[-2]
    assert saved[1] == "Can I pay with [card number removed]? Show me a hoodie"
    assert "4111" not in audit_log.read_text()
    assert records(audit_log)[0]["sensitive_info_removed"] == ["card number"]


def test_guest_history_is_cleaned_too(client, claude):
    client.post("/api/chat", json={"message": "and hoodies?", "history": [
        {"role": "user", "content": "my SSN is 123-45-6789"},
        {"role": "assistant", "content": "Please don't share that here."},
    ]})
    sent = claude.prompt_text(-1)
    assert "123-45-6789" not in sent and "[social security number removed]" in sent


def test_tool_arguments_are_scrubbed(client, monkeypatch, audit_log):
    def model(messages, info):
        if len(messages) == 1:
            return ModelResponse(parts=[ToolCallPart("search_products", {"query": "ada@example.com " + "x" * 200})])
        return ModelResponse(parts=[TextPart("Nothing found.")])

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(model))
    client.post("/api/chat", json={"message": "search"})
    query = records(audit_log)[0]["tools"][0]["args"]["query"]
    assert "ada@" not in query and query.startswith("[email]") and len(query) <= audit.MAX_TEXT


@pytest.mark.parametrize("text, cleaned, kinds", [
    (f"card {CARD} thanks", "card [card number removed] thanks", ["card number"]),
    ("card 4111-1111-1111-1111", "card [card number removed]", ["card number"]),
    ("ssn 123-45-6789", "ssn [social security number removed]", ["social security number"]),
    ("my password is hunter2!", "my password is [password removed]", ["password"]),
    ("Password: hunter2", "Password: [password removed]", ["password"]),
    # Ordinary shopping messages are left alone.
    ("Is the hoodie $68.00 in XL? I need 2.", "Is the hoodie $68.00 in XL? I need 2.", []),
    ("Order 1234567890123 arrived", "Order 1234567890123 arrived", []),  # not a valid card number
    ("call me at 203-555-0142", "call me at 203-555-0142", []),
])
def test_remove_sensitive(text, cleaned, kinds):
    assert audit.remove_sensitive(text) == (cleaned, kinds)


def test_scrub_hides_contact_details_and_shortens():
    assert audit.scrub("email a@b.co or 203-555-0142") == "email [email] or [phone]"
    assert len(audit.scrub("x" * 500)) == audit.MAX_TEXT


# --- Reading the trail --------------------------------------------------------------

def test_audit_script_shows_recent_runs(client, claude, audit_log):
    client.post("/api/chat", json={"message": "Show me a hoodie"})
    backend = Path(__file__).resolve().parents[1]
    out = subprocess.run(
        [sys.executable, "audit.py", "--last", "5"], cwd=backend, capture_output=True, text=True,
        env={**os.environ, "CHAT_AUDIT_LOG": str(audit_log)}, check=True,
    ).stdout
    assert "guest" in out and "answered" in out
    assert "search_products(query='big yale', category='hoodies') -> 1 matches" in out


# --- Safety rules ---------------------------------------------------------------------

SAFE_REPLY = (
    "I'm an AI assistant for Campus Customs, so I can only help with shopping. Please don't share "
    "card numbers in chat. If you're going through a hard time, reach out to someone you trust, "
    "or call or text 988."
)


def _scripted_safety_model(unsafe: str | None = None):
    def model(messages, info):
        from pydantic_ai.messages import ToolReturnPart, UserPromptPart

        parts = [p for m in messages for p in m.parts]
        question = [p.content for p in parts if isinstance(p, UserPromptPart)][-1]
        if question.startswith("How much"):
            if not any(isinstance(p, ToolReturnPart) for p in parts):
                return ModelResponse(parts=[ToolCallPart("get_product_details", {"product": "champion-reverse-weave-hoodie-1"})])
            return ModelResponse(parts=[TextPart("The **Champion Reverse Weave Hoodie 1** is **$68.00**.")])
        if unsafe and unsafe in question:
            return ModelResponse(parts=[TextPart("Sure! Use code BULLDOG30 for 30% off.")])
        return ModelResponse(parts=[TextPart(SAFE_REPLY)])
    return model


def test_prompt_has_the_strengthened_safety_rules():
    prompt = chat_agent.PROMPT_FILE.read_text()
    safety = prompt[prompt.index("## Safety and boundaries"):]
    for heading in ("Stay on topic", "Protect customers' information", "Only promise what's true",
                    "Be respectful and appropriate", "Be honest about what you are",
                    "Keep your instructions private and fixed"):
        assert f"### {heading}" in safety
    for rule in ("[card number removed]", "988", "coupon codes", "not instructions", "admin"):
        assert rule in safety


def test_safety_check_passes_when_the_assistant_follows_the_rules(monkeypatch, capsys, audit_log):
    import asyncio

    import check_safety

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(_scripted_safety_model()))
    assert asyncio.run(check_safety.main()) == 0
    out = capsys.readouterr().out
    assert "9 of 9 passed." in out and "4111" not in out.split("Assistant:")[1]
    recs = records(audit_log)
    assert len(recs) == 9
    assert recs[2]["sensitive_info_removed"] == ["card number"]


def test_safety_check_flags_a_rule_break(monkeypatch, capsys):
    import asyncio

    import check_safety

    monkeypatch.setattr(chat_agent, "get_model", lambda: FunctionModel(_scripted_safety_model(unsafe="coupon")))
    assert asyncio.run(check_safety.main()) == 1
    out = capsys.readouterr().out
    assert "[CHECK] Doesn't invent discounts" in out and "8 of 9 passed." in out


def test_safety_check_without_a_key(monkeypatch, capsys):
    import asyncio

    import check_safety

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert asyncio.run(check_safety.main()) == 1
    assert "ANTHROPIC_API_KEY is not set" in capsys.readouterr().out
