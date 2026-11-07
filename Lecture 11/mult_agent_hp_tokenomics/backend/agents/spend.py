"""Live spend ledger: tokens -> dollars per agent, checked against the budget."""

from __future__ import annotations

from dataclasses import dataclass, field

from pricing import cost_usd


class BudgetExceeded(RuntimeError):
    """Raised the moment total spend reaches the budget, to stop every agent."""


@dataclass
class SpendLedger:
    model: str
    budget_usd: float
    agents: dict[str, dict] = field(default_factory=dict)
    blown: bool = False

    def add(self, agent: str, input_tokens: int, output_tokens: int) -> float:
        row = self.agents.setdefault(agent, {"input_tokens": 0, "output_tokens": 0, "usd": 0.0})
        usd = cost_usd(self.model, input_tokens, output_tokens)
        row["input_tokens"] += input_tokens
        row["output_tokens"] += output_tokens
        row["usd"] += usd
        return usd

    @property
    def total_usd(self) -> float:
        return sum(r["usd"] for r in self.agents.values())

    def snapshot(self) -> dict:
        return {
            "model": self.model,
            "budget_usd": self.budget_usd,
            "total_usd": self.total_usd,
            "input_tokens": sum(r["input_tokens"] for r in self.agents.values()),
            "output_tokens": sum(r["output_tokens"] for r in self.agents.values()),
            "agents": {k: dict(v) for k, v in self.agents.items()},
        }
