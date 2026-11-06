"""Problem 4: review all 12 practice documents and compare the cost with and without prompt caching.

Two modes:

  python3 scripts/caching_comparison.py            # simulated (default, no API key needed)
  python3 scripts/caching_comparison.py --live     # real GPT-6 Luna runs (needs OPENAI_API_KEY)

Simulated: the real agent runs through PydanticAI's real OpenAI client, but the HTTP
calls are answered locally by a stand-in that follows the same review steps a good
model would. Every request the agent would have sent to OpenAI is captured and its
tokens counted with tiktoken (o200k_base). The same requests are then priced twice
at the GPT-6 Luna rates in data/prices.json:

  - without caching: every input token at the input rate;
  - with caching:    the parts that are the same in every request (tool definitions,
                     instructions and handbook) are written to the cache once, then
                     read from it at the cached rate.

Live: each document is reviewed twice on GPT-6 Luna. In the "without caching" pass,
a random line is put at the start of every request's instructions, so OpenAI can't
reuse any earlier request. In the "with caching" pass the requests are left alone.
Token counts and cached tokens come from OpenAI's usage reports.

Results are saved to output/caching_results.json.
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
HW6 = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HW6))

import httpx2  # noqa: E402  (the HTTP library openai>=3 uses)
import tiktoken  # noqa: E402
from openai import AsyncOpenAI  # noqa: E402
from pydantic_ai.models.openai import OpenAIChatModel  # noqa: E402
from pydantic_ai.providers.openai import OpenAIProvider  # noqa: E402

import agent as vendor_agent  # noqa: E402
from tools import check_purchase, find_vendors_in_text, load_handbook  # noqa: E402

DATA = HW6 / "data"
PRACTICE = DATA / "practice_docs"
OUT = HW6 / "output" / "caching_results.json"
RATES = json.loads((DATA / "prices.json").read_text())["gpt-6-luna"]
KEY = {row["file"]: row for row in json.loads((DATA / "practice_key.json").read_text())}
KEY_FIELDS = ("vendor", "sku", "unit_price", "lead_time_days", "min_order", "decision")

ENC = tiktoken.get_encoding("o200k_base")
PER_MESSAGE = 3  # OpenAI chat format: about 3 tokens of wrapping per message
REPLY_PRIMING = 3  # and 3 more to start the reply
CACHE_MIN, CACHE_BLOCK = 1024, 128  # OpenAI caches prefixes of 1,024+ tokens, in 128-token steps

DAILY_DOCS, DAYS = 1000, 30


def tokens(text: str) -> int:
    return len(ENC.encode(text, disallowed_special=()))


def dollars(n_tokens: int, rate_per_1m: float) -> float:
    return n_tokens * rate_per_1m / 1_000_000


# ---------------------------------------------------------------------------
# Simulated OpenAI: answers each request the way a correct review would go
# ---------------------------------------------------------------------------


def _respond(body: dict, handbook) -> dict:
    messages = body["messages"]
    names = {c["id"]: c["function"]["name"]
             for m in messages if m["role"] == "assistant" for c in m.get("tool_calls") or []}
    results = {names.get(m["tool_call_id"]): m["content"] for m in messages if m["role"] == "tool"}
    document = next(m["content"] for m in messages if m["role"] == "user")
    if isinstance(document, list):
        document = " ".join(part.get("text", "") for part in document)
    vendors = find_vendors_in_text(handbook, document.split("<vendor_document>", 1)[1])
    vendor = vendors[0] if vendors else "unknown"
    step = sum(1 for m in messages if m["role"] == "assistant") + 1

    if "get_quote_fields" not in results:
        calls = [("get_quote_fields", {}), ("look_up_vendor", {"vendor_name": vendor})]
    else:
        fields = json.loads(results["get_quote_fields"])
        facts = {k: fields[k] for k in ("sku", "unit_price", "lead_time_days", "min_order")}
        if "check_purchase_rules" not in results:
            calls = [("check_purchase_rules", {"vendor": vendor, **facts})]
        else:
            policy = check_purchase(handbook, vendor, **facts)
            reason = vendor_agent._offline_reason(policy)
            calls = [("final_result", {"vendor": vendor, **facts, "decision": policy.decision, "reason": reason})]

    tool_calls = [{"id": f"call_{step}_{i}", "type": "function",
                   "function": {"name": n, "arguments": json.dumps(a)}} for i, (n, a) in enumerate(calls)]
    return {"id": f"sim-{step}", "object": "chat.completion", "created": 0, "model": body["model"],
            "choices": [{"index": 0, "finish_reason": "tool_calls",
                         "message": {"role": "assistant", "content": None, "tool_calls": tool_calls}}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}


def simulated_model(captured: list, handbook) -> OpenAIChatModel:
    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        reply = _respond(body, handbook)
        captured.append({"request": body, "response": reply})
        return httpx2.Response(200, json=reply)

    client = AsyncOpenAI(api_key="simulated", base_url=vendor_agent.OPENAI_API_URL,
                         http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    return OpenAIChatModel(vendor_agent.DEFAULT_MODEL, provider=OpenAIProvider(openai_client=client))


def count_request(body: dict) -> dict:
    """Split a request's input tokens into the shared prefix (tools + instructions) and the rest."""
    tools_tokens = tokens(json.dumps(body.get("tools", [])))
    msgs = body["messages"]
    system = msgs[0]
    assert system["role"] in ("system", "developer")
    prefix = tools_tokens + PER_MESSAGE + tokens(system["content"])
    rest = REPLY_PRIMING
    for m in msgs[1:]:
        text = m.get("content") or ""
        if isinstance(text, list):
            text = " ".join(p.get("text", "") for p in text)
        rest += PER_MESSAGE + tokens(text) + tokens(json.dumps(m.get("tool_calls") or []))
    return {"tools": tools_tokens, "prefix": prefix, "input": prefix + rest}


def count_response(reply: dict) -> int:
    message = reply["choices"][0]["message"]
    return tokens(json.dumps(message.get("tool_calls") or [])) + tokens(message.get("content") or "")


def simulate() -> dict:
    handbook = load_handbook(vendor_agent.HANDBOOK_PATH)
    docs, cache_warm = [], False
    for path in sorted(PRACTICE.iterdir()):
        captured: list = []
        run = vendor_agent.review_document(path, model=simulated_model(captured, handbook), log_path=None)
        requests = []
        for exchange in captured:
            c = count_request(exchange["request"])
            out = count_response(exchange["response"])
            cacheable = (c["prefix"] // CACHE_BLOCK) * CACHE_BLOCK if c["prefix"] >= CACHE_MIN else 0
            read = cacheable if cache_warm else 0
            write = 0 if cache_warm else cacheable
            cache_warm = cache_warm or cacheable > 0
            requests.append({
                "input_tokens": c["input"], "shared_prefix_tokens": c["prefix"], "tool_definition_tokens": c["tools"],
                "output_tokens": out,
                "without_caching": {"cost": dollars(c["input"], RATES["input_per_1m"]) + dollars(out, RATES["output_per_1m"])},
                "with_caching": {
                    "cache_read_tokens": read, "cache_write_tokens": write,
                    "uncached_input_tokens": c["input"] - read - write,
                    "cost": dollars(c["input"] - read - write, RATES["input_per_1m"])
                    + dollars(read, RATES["cached_input_per_1m"]) + dollars(write, RATES["cache_write_per_1m"])
                    + dollars(out, RATES["output_per_1m"]),
                },
            })
        docs.append(_doc_result(path.name, run, requests))
    return _summarize(docs, mode="simulated")


# ---------------------------------------------------------------------------
# Live runs on GPT-6 Luna
# ---------------------------------------------------------------------------


def live() -> dict:
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY isn't set. Live mode makes real GPT-6 Luna calls.")
    docs = []
    for path in sorted(PRACTICE.iterdir()):
        passes = {}
        for label, bust in (("without_caching", True), ("with_caching", False)):
            vendor_agent.CACHE_BUSTER = bust
            try:
                run = vendor_agent.review_document(path, log_path=vendor_agent.RUN_LOG_PATH)
            finally:
                vendor_agent.CACHE_BUSTER = False
            passes[label] = run
        a, b = passes["without_caching"], passes["with_caching"]
        requests = [{
            "input_tokens": b.tokens.input_tokens, "output_tokens": b.tokens.output_tokens,
            "without_caching": {"cost": a.cost.total, "input_tokens": a.tokens.input_tokens,
                                "cache_read_tokens": a.tokens.cache_read_tokens, "output_tokens": a.tokens.output_tokens},
            "with_caching": {"cost": b.cost.total, "cache_read_tokens": b.tokens.cache_read_tokens,
                             "cache_write_tokens": b.tokens.cache_write_tokens,
                             "uncached_input_tokens": b.tokens.input_tokens - b.tokens.cache_read_tokens},
        }]
        result = _doc_result(path.name, b, requests)
        result["requests"] = b.tokens.requests
        result["without_caching_run"] = {"requests": a.tokens.requests, "decision": a.recommendation and a.recommendation.decision}
        docs.append(result)
    return _summarize(docs, mode="live")


# ---------------------------------------------------------------------------
# Totals, the 30-day projection and the Problem 2 comparison
# ---------------------------------------------------------------------------


def _doc_result(name: str, run, requests: list) -> dict:
    report = run.recommendation
    got = report.model_dump(include=set(KEY_FIELDS)) if report else {}
    expected = {f: KEY[name][f] for f in KEY_FIELDS}
    return {
        "file": name,
        "status": run.status,
        "decision": got.get("decision"),
        "matches_key": got == expected,
        "requests": len(requests),
        "tool_calls": [a.tool for a in run.tool_activity],
        "attempted_actions": len(run.attempted_actions),
        "input_tokens": sum(r["input_tokens"] for r in requests),
        "output_tokens": sum(r["output_tokens"] for r in requests),
        "cache_read_tokens": sum(r["with_caching"]["cache_read_tokens"] for r in requests),
        "cache_write_tokens": sum(r["with_caching"]["cache_write_tokens"] for r in requests),
        "cost_without_caching": sum(r["without_caching"]["cost"] for r in requests),
        "cost_with_caching": sum(r["with_caching"]["cost"] for r in requests),
        "per_request": requests,
    }


def _summarize(docs: list, mode: str) -> dict:
    n = len(docs)
    total = {k: sum(d[k] for d in docs) for k in
             ("requests", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
              "cost_without_caching", "cost_with_caching")}
    saved = total["cost_without_caching"] - total["cost_with_caching"]

    # Steady state: a document reviewed while the cache is already warm (every document but the first).
    warm = [d for d in docs if d["cache_write_tokens"] == 0] or docs
    per_doc_cached = sum(d["cost_with_caching"] for d in warm) / len(warm)
    per_doc_uncached = total["cost_without_caching"] / n
    first_write_extra = docs[0]["cost_with_caching"] - per_doc_cached

    month = DAILY_DOCS * DAYS
    projection = {
        "documents": month,
        "without_caching": per_doc_uncached * month,
        "with_caching_one_cache_write_per_day": per_doc_cached * month + first_write_extra * DAYS,
        # Worst case: the cache has expired before every document, so each one writes it again.
        "with_caching_cache_rewritten_for_every_document": docs[0]["cost_with_caching"] * month,
    }
    projection["savings_one_write_per_day"] = projection["without_caching"] - projection["with_caching_one_cache_write_per_day"]

    handbook_tokens = 10_069  # Problem 2 (hw6/output/handbook_estimate.md)
    problem2 = {
        "handbook_tokens": handbook_tokens,
        "assumed_requests_per_document": 1,
        "cost_per_document_without_caching": dollars(handbook_tokens, RATES["input_per_1m"]),
        "cost_per_document_with_caching_warm": dollars(handbook_tokens, RATES["cached_input_per_1m"]),
        "cost_1000_calls_without_caching": dollars(handbook_tokens, RATES["input_per_1m"]) * 1000,
        "cost_1000_calls_with_caching": dollars(handbook_tokens, RATES["cache_write_per_1m"])
        + 999 * dollars(handbook_tokens, RATES["cached_input_per_1m"]),
    }
    first = docs[0]["per_request"][0]
    return {
        "mode": mode,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": vendor_agent.DEFAULT_MODEL,
        "rates_per_1m": RATES,
        "documents": n,
        "documents_matching_key": sum(d["matches_key"] for d in docs),
        "totals": {**total, "savings": saved, "savings_percent": 100 * saved / total["cost_without_caching"] if total["cost_without_caching"] else 0.0},
        "per_document": {
            "average_requests": total["requests"] / n,
            "average_input_tokens": total["input_tokens"] / n,
            "average_output_tokens": total["output_tokens"] / n,
            "cost_without_caching": per_doc_uncached,
            "cost_with_caching_warm_cache": per_doc_cached,
        },
        "request_breakdown_first_request": {
            k: first[k] for k in ("input_tokens", "shared_prefix_tokens", "tool_definition_tokens") if k in first
        },
        "projection_1000_per_day_for_30_days": projection,
        "problem_2_estimate": problem2,
        "documents_detail": docs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--live", action="store_true", help="make real GPT-6 Luna calls (needs OPENAI_API_KEY)")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    results = live() if args.live else simulate()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")

    t, p = results["totals"], results["projection_1000_per_day_for_30_days"]
    print(f"Mode: {results['mode']}. {results['documents_matching_key']}/{results['documents']} match the key.")
    print(f"12 documents: {t['requests']} requests, {t['input_tokens']:,} input tokens "
          f"({t['cache_read_tokens']:,} read from cache, {t['cache_write_tokens']:,} written), "
          f"{t['output_tokens']:,} output tokens")
    print(f"  without caching: ${t['cost_without_caching']:.6f}")
    print(f"  with caching:    ${t['cost_with_caching']:.6f}  (saves ${t['savings']:.6f}, {t['savings_percent']:.1f}%)")
    print(f"30 days x 1,000/day: ${p['without_caching']:.2f} without, "
          f"${p['with_caching_one_cache_write_per_day']:.2f} with caching")
    print(f"Saved to {args.out}")


if __name__ == "__main__":
    main()
