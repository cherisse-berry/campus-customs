"""Turn every PydanticAI agent-loop node into a queue event.

run_traced() drives agent.iter() node by node and emits an `agent_step` event
for each one, so the dashboard sees the whole loop: prompt in, model request,
model response (text + tool calls + tokens), tool results, end.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from pydantic_ai import Agent
from pydantic_ai.messages import (
    RetryPromptPart,
    TextPart,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
)

Emit = Callable[..., None]


def clip(value: Any, limit: int = 800) -> str:
    text = value if isinstance(value, str) else str(value)
    return text if len(text) <= limit else text[:limit] + f"… (+{len(text) - limit} chars)"


def usage_dict(usage: Any) -> dict:
    return {
        "requests": getattr(usage, "requests", 0),
        "input_tokens": getattr(usage, "input_tokens", 0) or 0,
        "output_tokens": getattr(usage, "output_tokens", 0) or 0,
        "tool_calls": getattr(usage, "tool_calls", 0) or 0,
    }


def describe_node(node: Any) -> tuple[str, dict] | None:
    if Agent.is_user_prompt_node(node):
        return "user_prompt", {"prompt": clip(node.user_prompt)}

    if Agent.is_model_request_node(node):
        parts = node.request.parts
        returns = [
            {"tool": p.tool_name, "tool_call_id": p.tool_call_id, "content": clip(p.model_response_str(), 500)}
            for p in parts
            if isinstance(p, ToolReturnPart)
        ]
        retries = [clip(p.model_response(), 300) for p in parts if isinstance(p, RetryPromptPart)]
        return "model_request", {
            "parts": [type(p).__name__ for p in parts],
            "tool_returns": returns,
            "retries": retries,
        }

    if Agent.is_call_tools_node(node):
        resp = node.model_response
        text = "".join(p.content for p in resp.parts if isinstance(p, TextPart))
        thinking = "".join(p.content for p in resp.parts if isinstance(p, ThinkingPart))
        calls = [
            {"tool": p.tool_name, "tool_call_id": p.tool_call_id, "args": p.args_as_dict()}
            for p in resp.parts
            if isinstance(p, ToolCallPart)
        ]
        return "model_response", {
            "model": resp.model_name,
            "text": clip(text),
            "thinking": clip(thinking, 400) if thinking else "",
            "tool_calls": calls,
            "usage": usage_dict(resp.usage),
            "finish_reason": getattr(resp, "finish_reason", None),
        }

    if Agent.is_end_node(node):
        return "end", {"output": clip(node.data.output)}

    return None


async def run_traced(
    agent: Agent,
    prompt: str,
    *,
    emit: Emit,
    agent_name: str,
    deps: Any = None,
    model: Any = None,
    **extra: Any,
) -> tuple[Any, dict]:
    """Run an agent, emitting one agent_step per loop node. Returns (output, usage)."""
    started = time.perf_counter()
    async with agent.iter(prompt, deps=deps, model=model) as run:
        step = 0
        async for node in run:
            described = describe_node(node)
            if described is None:
                continue
            step += 1
            kind, data = described
            emit("agent_step", agent=agent_name, step=step, kind=kind, **extra, **data)
        run_usage = run.usage() if callable(run.usage) else run.usage
        usage = usage_dict(run_usage)
        usage["seconds"] = round(time.perf_counter() - started, 2)
        return run.result.output, usage
