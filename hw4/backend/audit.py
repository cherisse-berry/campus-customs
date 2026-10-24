"""Audit trail for the shopping assistant.

Every time the chatbot runs, one record is added to output/audit_trail.json: when it ran, which
tools it called with a short summary of each result, and why it stopped. The file is a JSON array
with one record per line. A new record replaces only the closing "]", so earlier records are
never rewritten or deleted.

No message text, names, emails, IP addresses or user IDs are written, only counts and catalogue
facts. Card numbers, Social Security numbers and passwords are also removed from customer
messages before they reach the model or the saved chat history (see remove_sensitive).

Read the trail with:  python audit.py            (the last 20 runs)
                      python audit.py --last 50
"""

import json
import logging
import os
import re
import threading

try:
    import fcntl  # file locking on macOS and Linux, so two API processes can't write at once
except ImportError:  # Windows
    fcntl = None
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic_ai.exceptions import (
    ContentFilterError,
    ModelAPIError,
    ModelHTTPError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryFeedbackPart,
    RetryPromptPart,
    ToolCallPart,
    ToolReturnPart,
)

from models import CategoryInfo, LookupProblem, ProductDetails, SearchResults, SimilarProducts, SizeAvailability

log = logging.getLogger(__name__)

AUDIT_LOG = Path(
    os.environ.get("CHAT_AUDIT_LOG", "").strip() or Path(__file__).resolve().parent.parent / "output" / "audit_trail.json"
)
# Where the trail was kept before (JSON Lines). Its records are moved into AUDIT_LOG on the next write.
LEGACY_LOG = Path(__file__).parent / "logs" / "chat_audit.jsonl"
MAX_TEXT = 80  # longest text kept from a tool argument or result
_write_lock = threading.Lock()

# --- Sensitive information -----------------------------------------------------------

_CARD = re.compile(r"(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_PASSWORD = re.compile(r"\b(password|passcode|pin)(\s+is|\s*[:=])\s*\S+", re.IGNORECASE)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)")


def _luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


def _replace_cards(text: str, found: list[str]) -> str:
    def swap(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group())
        if _luhn_ok(digits):
            found.append("card number")
            return "[card number removed]"
        return m.group()
    return _CARD.sub(swap, text)


def remove_sensitive(text: str) -> tuple[str, list[str]]:
    """Remove card numbers, Social Security numbers and passwords from a customer message.

    Returns the cleaned text and the kinds removed (e.g. ["card number"]). The model sees the
    placeholder, so it can tell the customer not to share such details, and the saved chat
    history never holds them.
    """
    found: list[str] = []
    text = _replace_cards(text, found)
    if _SSN.search(text):
        found.append("social security number")
        text = _SSN.sub("[social security number removed]", text)
    if _PASSWORD.search(text):
        found.append("password")
        text = _PASSWORD.sub(lambda m: f"{m.group(1)}{m.group(2)} [password removed]", text)
    return text, sorted(set(found))


def scrub(value: object) -> str:
    """Text that's safe for the audit trail: no contact or payment details, and kept short."""
    text, _ = remove_sensitive(" ".join(str(value).split()))
    text = _EMAIL.sub("[email]", text)
    text = _PHONE.sub("[phone]", text)
    return text if len(text) <= MAX_TEXT else text[: MAX_TEXT - 1] + "…"


# --- Writing records -------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _line(record: dict) -> bytes:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _append(path: Path, records: list[dict]) -> None:
    """Add records to the JSON array in `path`, touching only its closing bracket."""
    # 0o600: readable only by the account running the API.
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(fd, "r+b") as f:
        if fcntl:
            fcntl.flock(f, fcntl.LOCK_EX)
        existing = f.read()
        body = b",\n".join(_line(r) for r in records)
        if not existing.strip():
            f.write(b"[\n" + body + b"\n]\n")
        else:
            current = json.loads(existing)  # raises ValueError if the file isn't valid JSON
            if not isinstance(current, list):
                raise ValueError("the audit trail isn't a JSON array")
            # Overwrite only the closing "]" and the blank space around it: earlier records stay
            # byte for byte.
            close_at = len(existing[: existing.rindex(b"]")].rstrip())
            f.seek(close_at)
            f.truncate()
            f.write((b",\n" if current else b"\n") + body + b"\n]\n")
        f.flush()
        os.fsync(f.fileno())


def _set_aside(path: Path) -> Path:
    """Keep an unreadable trail under a new name (never delete it) so a fresh one can start."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    kept = path.with_name(f"{path.stem}.unreadable-{stamp}{path.suffix}")
    path.rename(kept)
    return kept


def _import_legacy(path: Path) -> None:
    """Move records from the old JSON Lines file into the JSON trail, then rename the old file."""
    if not LEGACY_LOG.exists() or Path(LEGACY_LOG).resolve() == path.resolve():
        return
    old = []
    for line in LEGACY_LOG.read_text(encoding="utf-8").splitlines():
        try:
            old.append(json.loads(line))
        except ValueError:
            continue
    if old:
        _append(path, old)
    LEGACY_LOG.rename(LEGACY_LOG.with_name(LEGACY_LOG.name + ".imported"))


def write(record: dict) -> None:
    """Add one record to the trail. Never raises: a logging problem must not break the chat."""
    path = Path(AUDIT_LOG)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with _write_lock:
            _import_legacy(path)
            try:
                _append(path, [record])
            except ValueError:
                kept = _set_aside(path)
                log.warning("The audit trail wasn't valid JSON, so it was kept as %s and a new one started.", kept.name)
                _append(path, [record])
    except OSError as e:
        log.warning("Couldn't write the chat audit trail (%s): %s", path, e)


def record_rate_limited(logged_in: bool) -> None:
    """A message turned away by the rate limit (the chatbot didn't run)."""
    write({
        "time": _now(),
        "event": "chat_blocked",
        "customer": "logged_in" if logged_in else "guest",
        "stop": {"reason": "rate_limited", "detail": "too many messages in 10 minutes"},
    })


# --- Summarising a run ------------------------------------------------------------------


def summarize_result(content: object) -> str:
    """A one-line summary of what a tool returned: ids, prices and stock, never customer data."""
    if isinstance(content, LookupProblem):
        return "not found: " + scrub(content.error)
    if isinstance(content, SearchResults):
        ids = ", ".join(p.product_id for p in content.products[:3])
        more = "…" if content.showing > 3 else ""
        return f"{content.total_matches} matches, {content.showing} shown to the model" + (f": {ids}{more}" if ids else "")
    if isinstance(content, ProductDetails):
        sold_out = ", ".join(content.sold_out_sizes) or "none"
        return f"{content.product_id}: {content.price}, {content.total_in_stock} in stock, sold out: {sold_out}"
    if isinstance(content, SizeAvailability):
        return f"{content.product_id} {content.size}: {content.status} ({content.quantity}), {content.price}"
    if isinstance(content, SimilarProducts):
        ids = ", ".join(a.product_id for a in content.alternatives)
        return f"{len(content.alternatives)} alternatives {content.looking_for}" + (f": {ids}" if ids else "")
    if isinstance(content, list) and all(isinstance(c, CategoryInfo) for c in content):
        return f"{len(content)} categories"
    return scrub(content)


def _retry_text(part: RetryPromptPart | ToolReturnPart) -> str:
    if isinstance(part.content, str):
        return scrub(part.content)
    return scrub("; ".join(str(e.get("msg", e)) for e in part.content))


def steps(messages: list[ModelMessage]) -> tuple[list[dict], int]:
    """The tool calls in a run, each with its arguments and a result summary, and how many
    times the price check sent the reply back."""
    calls: dict[str, dict] = {}
    ordered: list[dict] = []
    price_corrections = 0
    for message in messages:
        for part in message.parts:
            if isinstance(message, ModelResponse) and isinstance(part, ToolCallPart):
                step = {
                    "tool": part.tool_name,
                    "args": {k: scrub(v) if isinstance(v, str) else v for k, v in part.args_as_dict().items()},
                    "result": "no result (the run stopped first)",
                }
                calls[part.tool_call_id] = step
                ordered.append(step)
            elif isinstance(message, ModelRequest) and isinstance(part, ToolReturnPart):
                if part.tool_call_id in calls:
                    # A tool that raised ModelRetry (bad arguments) comes back with outcome "retried".
                    rejected = getattr(part, "outcome", "success") != "success"
                    calls[part.tool_call_id]["result"] = (
                        "rejected, asked to retry: " + _retry_text(part) if rejected else summarize_result(part.content))
            elif isinstance(message, ModelRequest) and isinstance(part, RetryPromptPart):
                if part.tool_name and part.tool_call_id in calls:
                    calls[part.tool_call_id]["result"] = "rejected, asked to retry: " + _retry_text(part)
                elif not part.tool_name:
                    price_corrections += 1
            elif isinstance(message, ModelRequest) and isinstance(part, RetryFeedbackPart):
                price_corrections += 1  # the price check (the only output check) sent the reply back
    return ordered, price_corrections


def stop_for(error: BaseException) -> dict:
    """Why a run ended without an answer."""
    if getattr(error, "audit_reason", None):
        return {"reason": error.audit_reason, "detail": scrub(error)}
    if isinstance(error, ContentFilterError):
        return {"reason": "refused", "detail": "the model's safety filter declined the request"}
    if isinstance(error, UsageLimitExceeded):
        return {"reason": "usage_limit", "detail": scrub(error)}
    if isinstance(error, ModelHTTPError):
        return {"reason": "model_error", "detail": f"HTTP {error.status_code}"}
    if isinstance(error, UnexpectedModelBehavior):
        return {"reason": "unexpected_model_behavior", "detail": scrub(error)}
    if isinstance(error, ModelAPIError):
        return {"reason": "model_error", "detail": type(error).__name__}
    return {"reason": "error", "detail": type(error).__name__}


class ChatRun:
    """Collects one chatbot run and appends it to the audit trail when it finishes."""

    def __init__(self, *, logged_in: bool, viewing: dict | None, message: str, history: int,
                 model: str, sensitive_removed: list[str] | None = None):
        self.started = time.monotonic()
        self.record = {
            "time": _now(),
            "event": "chat_run",
            "run_id": uuid.uuid4().hex[:12],
            "customer": "logged_in" if logged_in else "guest",
            "viewing_product": viewing["product_id"] if viewing else None,
            "message_chars": len(message),
            "history_messages": history,
            "sensitive_info_removed": sensitive_removed or [],
            "model": model,
        }

    def finish(self, messages: list[ModelMessage], *, turn=None, error: BaseException | None = None) -> dict:
        tool_steps, corrections = steps(messages)
        responses = [m for m in messages if isinstance(m, ModelResponse)]
        record = self.record | {
            "tools": tool_steps,
            "price_check_corrections": corrections,
            # The model(s) that actually answered: differs from "model" if the refusal fallback was used.
            "served_by": sorted({r.model_name for r in responses if r.model_name}),
            "model_calls": len(responses),
            "tokens": {
                "input": sum(r.usage.input_tokens for r in responses),
                "output": sum(r.usage.output_tokens for r in responses),
            },
        }
        if error is not None:
            record["stop"] = stop_for(error)
        else:
            finish = responses[-1].finish_reason if responses else None
            record["stop"] = {"reason": "answered", "detail": finish or "stop"}
            record["reply"] = {
                "chars": len(turn.reply),
                "product_cards": len(turn.cards),
                "page_results": len(turn.results),
                "suggestions": len(turn.suggestions),
            }
        record["duration_ms"] = round((time.monotonic() - self.started) * 1000)
        write(record)
        return record


# --- Reading the trail -------------------------------------------------------------------


def read(last: int = 20) -> list[dict]:
    """The most recent records (all of them if last is 0)."""
    path = Path(AUDIT_LOG)
    if not path.exists():
        return []
    records = json.loads(path.read_text(encoding="utf-8"))
    return records[-last:] if last else records


def _print(records: list[dict]) -> None:
    if not records:
        print(f"No chatbot runs recorded yet in {AUDIT_LOG}")
        return
    for r in records:
        stop = r.get("stop", {})
        print(f"{r['time']}  {r.get('run_id', '-'):12}  {r['customer']:9}  {stop.get('reason')} ({stop.get('detail')})"
              f"  {r.get('duration_ms', 0)} ms")
        for step in r.get("tools", []):
            args = ", ".join(f"{k}={v!r}" for k, v in step["args"].items())
            print(f"    {step['tool']}({args}) -> {step['result']}")
        if r.get("sensitive_info_removed"):
            print(f"    removed from the message: {', '.join(r['sensitive_info_removed'])}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Show recent chatbot runs from the audit trail.")
    parser.add_argument("--last", type=int, default=20, help="how many runs to show (default 20)")
    _print(read(parser.parse_args().last))
