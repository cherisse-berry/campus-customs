"""Check that gpt-6-luna works through Portkey, before running the agents.

  python check_portkey.py

Makes three tiny model calls (a few hundred tokens in total) and reports each:
  1. a plain reply                    - the key, the address and the model name work
  2. a tool call                      - the model can call tools, as the agents do with MCP tools
  3. structured output                - the model can return the typed results the agents return

It doesn't touch the database, start the MCP server, run the agents or write to the
audit trail. It exits with status 0 only if all three pass.
"""

from __future__ import annotations

import asyncio
import sys

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits

import config
from agents import AgentsNotConfigured, create_portkey_model

LIMITS = UsageLimits(request_limit=4, total_tokens_limit=4_000)


class Check(BaseModel):
    shop: str
    ok: bool


async def main() -> int:
    try:
        model = create_portkey_model()
    except AgentsNotConfigured as e:
        print(f"FAIL  setup: {e}")
        return 2
    print(f"Model {config.MODEL_NAME} at {config.PORTKEY_BASE_URL}\n")
    failures = 0

    async def step(label, coro, verify):
        nonlocal failures
        try:
            result = await coro
            ok, detail = verify(result)
            served = getattr(result.response, "model_name", None)
            print(f"{'PASS' if ok else 'FAIL'}  {label}: {detail}"
                  f"  [model reported: {served}; tokens: {result.usage.input_tokens + result.usage.output_tokens}]")
            failures += not ok
        except Exception as e:
            print(f"FAIL  {label}: {type(e).__name__}: {e}")
            failures += 1

    plain = Agent(model, instructions="Reply with exactly the word OK.")
    await step("plain reply", plain.run("Ready?", usage_limits=LIMITS),
               lambda r: ("OK" in r.output.upper(), repr(r.output[:60])))

    calls: list[str] = []
    tools = Agent(model, instructions="Use the shop_date tool, then reply with the date it returns.")

    @tools.tool_plain
    def shop_date() -> str:
        """The shop's date."""
        calls.append("shop_date")
        return "2026-08-31"

    await step("tool call", tools.run("What is the shop's date?", usage_limits=LIMITS),
               lambda r: (bool(calls) and "2026-08-31" in r.output, f"tool called {len(calls)} time(s); reply {r.output[:60]!r}"))

    structured = Agent(model, output_type=Check, instructions="Return shop='Campus Customs' and ok=true.")
    await step("structured output", structured.run("Fill in the check.", usage_limits=LIMITS),
               lambda r: (r.output.shop == "Campus Customs" and r.output.ok, repr(r.output)))

    print("\nAll checks passed: the agents can run." if not failures else f"\n{failures} check(s) failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
