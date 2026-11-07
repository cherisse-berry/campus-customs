"""Token -> dollar pricing for the models the app can run.

USD per 1M tokens (OpenAI API list prices for GPT-6, as reported Nov 2026):
  gpt-6-luna  $0.10 in / $0.50 out   (cheap default)
  gpt-6-sol   $2.00 in / $10.00 out  (~20x luna)
Long-context surcharges (>272K input tokens) and cached-input discounts are ignored:
every input token is billed at the full rate, so the meter errs on the high side.
"""

from __future__ import annotations

PRICES_PER_MTOK: dict[str, dict[str, float]] = {
    "gpt-6-luna": {"input": 0.10, "output": 0.50, "label": "GPT-6 Luna"},
    "gpt-6-sol": {"input": 2.00, "output": 10.00, "label": "GPT-6 Sol"},
}
DEFAULT_MODEL = "gpt-6-luna"
DEFAULT_BUDGET_USD = 10.0


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    p = PRICES_PER_MTOK.get(model, PRICES_PER_MTOK[DEFAULT_MODEL])
    return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000


def model_options() -> list[dict]:
    return [{"id": k, **v} for k, v in PRICES_PER_MTOK.items()]
