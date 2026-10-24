"""The PydanticAI agent: model, instructions, tools and how a chat turn is run."""

import os
import re
from functools import cache
from pathlib import Path

import config  # noqa: F401  (loads .env)
from pydantic_ai import Agent, ModelRetry, RunContext
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicModelSettings
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.usage import UsageLimits

from models import ChatDeps
from tools import TOOLS

PROMPT_FILE = Path(__file__).parent / "prompts" / "prompt.md"
DEFAULT_MODEL = "claude-opus-5-5"
ANTHROPIC_API_URL = "https://api.anthropic.com"
MAX_PRODUCT_CARDS = 6

# Models that accept the server-side refusal fallback ("fallbacks": "default").
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}

# A tool loop that runs away costs money; a normal answer needs at most a few model calls
# (plus up to two corrections from the price check below).
USAGE_LIMITS = UsageLimits(request_limit=8, tool_calls_limit=12)

# "$68", "$68.00", "$1,250.50"
DOLLAR_AMOUNT = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?")


class AssistantNotConfigured(RuntimeError):
    """ANTHROPIC_API_KEY is missing."""


agent = Agent(
    deps_type=ChatDeps,
    instructions=PROMPT_FILE.read_text(encoding="utf-8"),
    tools=TOOLS,
    retries={"output": 2},  # how many times the price check may send a reply back for correction
    defer_model_check=True,  # the model is created per run, once the API key is known
)


@agent.instructions
def customer_context(ctx: RunContext[ChatDeps]) -> str:
    if ctx.deps.customer_first_name:
        return f"The customer is logged in. Their first name is {ctx.deps.customer_first_name}."
    return "The customer is browsing as a guest (not logged in)."


def dollar_amounts(text: str) -> set[float]:
    amounts = set()
    for whole, cents in DOLLAR_AMOUNT.findall(text):
        amounts.add(round(float(whole.replace(",", "") + "." + (cents or "0")), 2))
    return amounts


def _is_supported(amount: float, deps: ChatDeps) -> bool:
    """A price from the tools, an amount the customer typed, or simple math on looked-up prices."""
    if amount in deps.known_prices or amount in deps.customer_amounts:
        return True
    prices = list(deps.known_prices)
    multiples = {round(p * n, 2) for p in prices for n in range(2, 11)}
    pair_sums = {round(a + b, 2) for i, a in enumerate(prices) for b in prices[i:]}
    return amount in multiples or amount in pair_sums


@agent.output_validator
def check_prices(ctx: RunContext[ChatDeps], reply: str) -> str:
    """Send the reply back if it quotes a price the catalogue tools didn't return this turn."""
    unsupported = sorted(a for a in dollar_amounts(reply) if not _is_supported(a, ctx.deps))
    if unsupported:
        listed = ", ".join(f"${a:,.2f}" for a in unsupported)
        raise ModelRetry(
            f"Your reply mentions {listed}, which doesn't match any price the tools returned for this "
            "reply. Prices must come from the database: look the product up with a tool and quote its "
            "exact price, or leave the amount out. Don't reuse prices from earlier messages without "
            "looking them up again."
        )
    return reply


def model_name() -> str:
    return os.environ.get("CHAT_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def api_url() -> str:
    # Deliberately not ANTHROPIC_BASE_URL: tools such as Claude Code set that for their own
    # connection, and the SDK would otherwise send this app's API key there.
    return os.environ.get("CHAT_ANTHROPIC_BASE_URL", "").strip() or ANTHROPIC_API_URL


@cache
def _anthropic_model(name: str, api_key: str, base_url: str = ANTHROPIC_API_URL) -> AnthropicModel:
    settings = AnthropicModelSettings(
        max_tokens=4096,
        # Chat replies are short; low effort keeps them fast and inexpensive.
        anthropic_effort="low",
    )
    if name in _FALLBACK_MODELS:
        # If Claude's safety filter declines a harmless request, the API retries it on another
        # model automatically instead of returning a refusal.
        settings["anthropic_betas"] = ["server-side-fallback-2026-07-01"]
        settings["extra_body"] = {"fallbacks": "default"}
    provider = AnthropicProvider(api_key=api_key, base_url=base_url)
    return AnthropicModel(name, provider=provider, settings=settings)


def get_model() -> Model:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise AssistantNotConfigured("ANTHROPIC_API_KEY is not set")
    return _anthropic_model(model_name(), api_key, api_url())


def to_model_history(turns: list[tuple[str, str]]) -> list[ModelMessage]:
    """Turn (role, text) pairs into PydanticAI messages. Starts with a customer turn."""
    messages: list[ModelMessage] = []
    for role, text in turns:
        if not text.strip():
            continue
        if role == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=text)]))
        elif messages:  # skip assistant turns before the first customer message (the greeting)
            messages.append(ModelResponse(parts=[TextPart(content=text)]))
    return messages


def cards_for_reply(reply: str, seen: dict[str, dict]) -> list[dict]:
    """The looked-up products the reply mentions by name, in the order they appear."""
    text = reply.lower()
    hits = []
    for product in seen.values():
        name = product["name"].lower()
        match = re.search(rf"(?<!\w){re.escape(name)}(?!\w)", text)
        if match:
            hits.append((match.start(), product))
    return [p for _, p in sorted(hits, key=lambda h: h[0])][:MAX_PRODUCT_CARDS]


async def run_chat(
    message: str, history: list[tuple[str, str]], customer_first_name: str | None
) -> tuple[str, list[dict]]:
    """Answer one customer message. Returns the reply text and product cards to show."""
    deps = ChatDeps(customer_first_name=customer_first_name)
    for text in [message, *(t for role, t in history if role == "user")]:
        deps.customer_amounts |= dollar_amounts(text)
    result = await agent.run(
        message,
        model=get_model(),
        deps=deps,
        message_history=to_model_history(history),
        usage_limits=USAGE_LIMITS,
    )
    reply = result.output.strip()
    return reply, cards_for_reply(reply, deps.seen_products)
