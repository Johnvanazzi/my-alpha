"""Backtest strategy registry.

Like `services/indicators.py`, every strategy is declared once with metadata
(name, description, parameters with defaults and bounds) and the frontend
builds its form from `GET /api/backtests/strategies`. `kind` says which engine
runs it: "stock" strategies are signal rules run by `stock.py` on one ticker,
"portfolio" strategies are allocation rules run by `portfolio.py` with `bt`.

To add a strategy: add a `Strategy` entry here and its implementation to the
engine (`stock.SIGNALS` or `portfolio._weigh_algo`).
"""

from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class Param:
    name: str
    label: str
    default: Any
    # "int" | "float" | "choice"
    type: str = "int"
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[str] | None = None


@dataclass(frozen=True)
class Strategy:
    id: str
    name: str
    description: str
    # "stock" | "portfolio"
    kind: str
    params: list[Param] = field(default_factory=list)
    # Cross-parameter checks (e.g. fast < slow); raise ValueError.
    check: Callable[[dict[str, Any]], None] | None = field(default=None, repr=False)

    def metadata(self) -> dict:
        data = asdict(self)
        data.pop("check")
        return data


def _fast_below_slow(params: dict[str, Any]) -> None:
    if params["fast"] >= params["slow"]:
        raise ValueError("fast period must be smaller than slow period")


def _rsi_bands(params: dict[str, Any]) -> None:
    if params["buy_below"] >= params["sell_above"]:
        raise ValueError("buy_below must be smaller than sell_above")


def _score_bands(params: dict[str, Any]) -> None:
    if params["exit_at"] >= params["enter_at"]:
        raise ValueError("the exit score must be below the entry score")


REBALANCE = Param("rebalance", "Rebalance", "quarterly", "choice", options=["monthly", "quarterly", "yearly"])
LOOKBACK = Param("lookback_months", "Lookback (months)", 12, "int", 1, 60)


STRATEGIES: dict[str, Strategy] = {
    s.id: s
    for s in [
        # --- Single stock: long or flat, signals on bar t traded at bar t+1's open ---
        Strategy(
            id="buy_and_hold",
            name="Buy and hold",
            description="Buy on the first bar and hold until the end. The baseline every other rule must beat.",
            kind="stock",
        ),
        Strategy(
            id="ma_crossover",
            name="Moving-average crossover",
            description="Long while the fast moving average is above the slow one, flat otherwise.",
            kind="stock",
            params=[
                Param("ma_type", "Average", "sma", "choice", options=["sma", "ema"]),
                Param("fast", "Fast", 50, "int", 2, 200),
                Param("slow", "Slow", 200, "int", 3, 400),
            ],
            check=_fast_below_slow,
        ),
        Strategy(
            id="rsi_mean_reversion",
            name="RSI mean reversion",
            description="Buy when RSI drops below the lower band (oversold), sell when it rises above the upper band.",
            kind="stock",
            params=[
                Param("period", "RSI period", 14, "int", 2, 100),
                Param("buy_below", "Buy below", 30, "int", 1, 99),
                Param("sell_above", "Sell above", 70, "int", 1, 99),
            ],
            check=_rsi_bands,
        ),
        Strategy(
            id="macd_crossover",
            name="MACD crossover",
            description="Long while the MACD line is above its signal line, flat otherwise.",
            kind="stock",
            params=[
                Param("fast", "Fast", 12, "int", 2, 100),
                Param("slow", "Slow", 26, "int", 3, 200),
                Param("signal", "Signal", 9, "int", 2, 100),
            ],
            check=_fast_below_slow,
        ),
        Strategy(
            id="score_threshold",
            name="Technical score",
            description=(
                "Recomputes the 0-10 technical summary score (every indicator, default parameters) on each bar. "
                "Enter when it reaches the entry level, exit when it falls to the exit level."
            ),
            kind="stock",
            params=[
                Param("enter_at", "Enter at score ≥", 6.5, "float", 0, 10, 0.5),
                Param("exit_at", "Exit at score ≤", 4.5, "float", 0, 10, 0.5),
            ],
            check=_score_bands,
        ),
        # --- Portfolio: allocation rules run with bt ---
        Strategy(
            id="portfolio_buy_and_hold",
            name="Buy and hold",
            description="Buy the saved weights once and let them drift. No rebalancing.",
            kind="portfolio",
        ),
        Strategy(
            id="fixed_weights",
            name="Saved weights, rebalanced",
            description="Rebalance back to the portfolio's saved weights on a fixed schedule.",
            kind="portfolio",
            params=[REBALANCE],
        ),
        Strategy(
            id="equal_weight",
            name="Equal weight",
            description="Rebalance to 1/N in every holding on a fixed schedule.",
            kind="portfolio",
            params=[REBALANCE],
        ),
        Strategy(
            id="inverse_volatility",
            name="Inverse volatility",
            description="Weights proportional to 1/volatility of each holding over the lookback window.",
            kind="portfolio",
            params=[REBALANCE, LOOKBACK],
        ),
        Strategy(
            id="min_variance",
            name="Minimum variance",
            description="Long-only minimum-variance weights (PyPortfolioOpt, Ledoit-Wolf covariance) estimated over the lookback window.",
            kind="portfolio",
            params=[REBALANCE, LOOKBACK],
        ),
        Strategy(
            id="hrp",
            name="Hierarchical Risk Parity",
            description="HRP weights (PyPortfolioOpt HRPOpt, single linkage) estimated over the lookback window.",
            kind="portfolio",
            params=[REBALANCE, LOOKBACK],
        ),
    ]
}


def get_strategy(strategy_id: str, kind: str) -> Strategy:
    strategy = STRATEGIES.get(strategy_id)
    if strategy is None or strategy.kind != kind:
        available = ", ".join(s.id for s in STRATEGIES.values() if s.kind == kind)
        raise ValueError(f"Unknown {kind} strategy '{strategy_id}'. Available: {available}")
    return strategy


def validate_params(strategy: Strategy, raw: dict[str, Any] | None) -> dict[str, Any]:
    """Fill defaults, coerce types and check bounds. Unknown parameters are rejected."""
    raw = dict(raw or {})
    known = {p.name for p in strategy.params}
    unknown = set(raw) - known
    if unknown:
        raise ValueError(f"{strategy.id}: unknown parameter(s) {', '.join(sorted(unknown))}")

    params: dict[str, Any] = {}
    for p in strategy.params:
        value = raw.get(p.name, p.default)
        if p.type == "choice":
            value = str(value).lower()
            if value not in (p.options or []):
                raise ValueError(f"{strategy.id}: {p.name} must be one of {', '.join(p.options or [])}")
        else:
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{strategy.id}: {p.name} must be a number") from exc
            if p.type == "int":
                if number != int(number):
                    raise ValueError(f"{strategy.id}: {p.name} must be an integer")
                number = int(number)
            if (p.min is not None and number < p.min) or (p.max is not None and number > p.max):
                raise ValueError(f"{strategy.id}: {p.name} must be between {p.min:g} and {p.max:g}")
            value = number
        params[p.name] = value

    if strategy.check:
        strategy.check(params)
    return params
