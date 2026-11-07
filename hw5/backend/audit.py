"""Audit trail for the Campus Customs agents: output/audit_trail.json.

Every action is recorded as one entry: runs starting and finishing, each agent's
MCP tool calls and results, delegations between agents and their answers,
decisions, approval requests, draft messages (never sent), usage, errors and
the human approval decisions made with approve.py.

The file is a JSON array with one entry per line. Adding entries replaces only
the closing "]", so earlier entries are never rewritten or deleted. If the file
isn't in that shape, nothing is written and an error is raised, so a damaged
trail is never overwritten.

Read it with:  python audit.py              (the last 30 entries)
               python audit.py --last 100
               python audit.py --run <run_id>
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import fcntl  # file locking on macOS and Linux
except ImportError:  # Windows
    fcntl = None

import config

_lock = threading.Lock()


class AuditTrailError(RuntimeError):
    """The audit trail file isn't a JSON array, so it won't be written to."""


def new_run_id() -> str:
    return "run_" + uuid.uuid4().hex[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class AuditTrail:
    def __init__(self, path: Path | None = None, shop_date: str | None = None):
        self.path = Path(path or config.AUDIT_TRAIL)
        self.shop_date = shop_date

    # ---- writing

    def record(self, event: str, *, run_id: str | None = None, agent: str | None = None,
               ticket_id: int | None = None, **details: Any) -> dict[str, Any]:
        entry = {
            "id": "evt_" + uuid.uuid4().hex[:12],
            "timestamp": _now(),
            "shop_date": self.shop_date,
            "run_id": run_id,
            "ticket_id": ticket_id,
            "agent": agent,
            "event": event,
            **details,
        }
        self._append(entry)
        return entry

    def _append(self, entry: dict[str, Any]) -> None:
        line = json.dumps(entry, ensure_ascii=False, default=str)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with _lock:
            fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o644)
            with os.fdopen(fd, "r+b") as f:
                if fcntl:
                    fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    data = f.read()
                    text = data.decode("utf-8")
                    stripped = text.strip()
                    if not stripped:
                        f.seek(0)
                        f.truncate()
                        f.write(("[\n" + line + "\n]\n").encode("utf-8"))
                        return
                    if not (stripped.startswith("[") and stripped.endswith("]")):
                        raise AuditTrailError(
                            f"{self.path} is not a JSON array, so nothing was written to it. "
                            "Move it aside to start a new trail.")
                    end = text.rstrip().rfind("]")
                    has_entries = stripped[1:-1].strip() != ""
                    before = text[:end].rstrip()
                    cut = len(before.encode("utf-8"))
                    f.seek(cut)
                    f.truncate()
                    f.write(((",\n" if has_entries else "\n") + line + "\n]\n").encode("utf-8"))
                finally:
                    if fcntl:
                        fcntl.flock(f, fcntl.LOCK_UN)

    # ---- reading

    def entries(self) -> list[dict[str, Any]]:
        if not self.path.exists() or not self.path.read_text(encoding="utf-8").strip():
            return []
        return json.loads(self.path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Show the Campus Customs audit trail.")
    parser.add_argument("--last", type=int, default=30)
    parser.add_argument("--run", help="show only this run_id")
    args = parser.parse_args()
    entries = AuditTrail().entries()
    if args.run:
        entries = [e for e in entries if e.get("run_id") == args.run]
    for e in entries[-args.last:]:
        details = {k: v for k, v in e.items()
                   if k not in {"id", "timestamp", "shop_date", "run_id", "ticket_id", "agent", "event"}}
        print(f"{e['timestamp']}  {e.get('run_id') or '-':16}  ticket {e.get('ticket_id') or '-':<4} "
              f"{e.get('agent') or '-':16} {e['event']}")
        if details:
            print("    " + json.dumps(details, ensure_ascii=False, default=str)[:300])


if __name__ == "__main__":
    main()
