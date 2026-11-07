"""Froggy Labubu — describes a webpage or PDF, with NO safeguards (we add them in class).

Tools:
- read_page()      returns the selected document's raw HTML or all PDF text, hidden text and all
- fetch_url(url)   FAKE web tool: records the URL in an outbox, never sends a request
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic_ai import Agent, RunContext
from pypdf import PdfReader
from pydantic_ai.messages import ModelMessage, ModelResponse, ThinkingPart, ToolCallPart
from pydantic_ai.models.openai import OpenAIResponsesModelSettings

from config import build_model

HERE = Path(__file__).resolve().parent
PAGES = HERE / "pages"
PROMPT = (HERE / "prompts" / "prompt.md").read_text(encoding="utf-8")


@dataclass
class Deps:
    page_name: str
    outbox: list[str] = field(default_factory=list)


agent = Agent(deps_type=Deps, instructions=PROMPT)


@agent.instructions
def page_context(ctx: RunContext[Deps]) -> str:
    return f"The selected document is: {ctx.deps.page_name}"


def page_text(name: str) -> str:
    """Raw HTML for web pages; all extracted text for PDFs (white text included)."""
    path = PAGES / name
    if path.suffix.lower() == ".pdf":
        return "\n".join(p.extract_text() or "" for p in PdfReader(path).pages)
    return path.read_text(encoding="utf-8")


@agent.tool
def read_page(ctx: RunContext[Deps]) -> str:
    """Read the full contents of the document the user selected."""
    if ctx.deps.page_name not in list_pages():
        return f"Page not found: {ctx.deps.page_name}"
    return page_text(ctx.deps.page_name)


@agent.tool
def fetch_url(ctx: RunContext[Deps], url: str) -> str:
    """Fetch a URL from the web and return its status."""
    ctx.deps.outbox.append(url)  # recorded only — no real request is ever made
    return "200 OK"


def list_pages() -> list[str]:
    return sorted(p.name for p in PAGES.iterdir() if p.suffix.lower() in (".html", ".pdf"))


def _reasoning_and_tools(messages: list[ModelMessage]) -> tuple[list[str], list[str]]:
    reasoning: list[str] = []
    tools: list[str] = []
    for msg in messages:
        if not isinstance(msg, ModelResponse):
            continue
        for part in msg.parts:
            if isinstance(part, ThinkingPart) and part.content.strip():
                reasoning.append(part.content.strip())
            elif isinstance(part, ToolCallPart):
                tools.append(part.tool_name)
    return reasoning, tools


async def run_chat(
    message: str,
    *,
    page_name: str,
    model_name: str,
    history: list[ModelMessage] | None,
) -> tuple[dict[str, Any], list[ModelMessage]]:
    deps = Deps(page_name=page_name)
    settings = OpenAIResponsesModelSettings(
        openai_reasoning_effort="medium",  # "low" often skips reasoning entirely → empty glass box
        openai_reasoning_summary="detailed",
    )
    result = await agent.run(
        message,
        model=build_model(model_name),
        deps=deps,
        message_history=history,
        model_settings=settings,
    )
    reasoning, tools = _reasoning_and_tools(result.new_messages())
    usage = result.usage() if callable(result.usage) else result.usage
    details = getattr(usage, "details", None) or {}
    payload = {
        "reply": result.output,
        "reasoning": reasoning,
        "reasoning_tokens": int(details.get("reasoning_tokens", 0)),
        "input_tokens": usage.input_tokens or 0,
        "output_tokens": usage.output_tokens or 0,
        "tools": tools,
        "outbox": deps.outbox,
    }
    return payload, result.all_messages()
