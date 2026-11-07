"""Run the Campus Customs agent team on open tickets.

  python run.py --ticket 101      handle one ticket
  python run.py --all             handle every open ticket, one at a time

Needs PORTKEY_API_KEY in hw5/.env (see hw5/.env.example), the working database
(hw5/setup_db.py) and the MCP server's virtual environment (hw5/mcp_server/README.md).

Nothing is paid and no message is sent. Payment and discount requests wait in the
audit trail for a person to decide with approve.py.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from pydantic_ai.exceptions import UsageLimitExceeded

from agents import AgentsNotConfigured, Team, create_portkey_model
from audit import AuditTrail


async def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Campus Customs agents on open tickets.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--ticket", type=int, help="ticket number, for example 101")
    group.add_argument("--all", action="store_true", help="every open ticket")
    args = parser.parse_args()

    try:
        model = create_portkey_model()
    except AgentsNotConfigured as e:
        print(e, file=sys.stderr)
        return 2

    audit = AuditTrail()
    async with Team(model, audit) as team:
        if args.all:
            tickets = [t["id"] for t in (await team.lookup("list_open_tickets", {}))["open_tickets"]]
        else:
            tickets = [args.ticket]
        status = 0
        for ticket_id in tickets:
            print(f"\n=== Ticket {ticket_id} ===")
            try:
                run_id, resolution = await team.handle_ticket(ticket_id)
            except UsageLimitExceeded as e:
                print(f"Stopped: AI usage limit reached ({e}). Recorded in the audit trail.")
                status = 1
                continue
            print(json.dumps(resolution.model_dump(), indent=2, ensure_ascii=False))
            print(f"\nRun {run_id} recorded in {audit.path}.")
            if resolution.status == "needs_human_approval":
                print("Waiting for a person to decide: run `python approve.py`.")
        return status


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
