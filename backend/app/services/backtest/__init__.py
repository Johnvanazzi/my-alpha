"""Strategy backtests.

- `registry`: strategy metadata and parameter validation.
- `stock`: single-stock long/flat signal rules (own pandas engine).
- `portfolio`: allocation / rebalancing rules (bt).
"""

from typing import Any

from . import portfolio, stock
from .registry import STRATEGIES, get_strategy, validate_params

__all__ = ["STRATEGIES", "get_strategy", "validate_params", "run_stock", "run_portfolio"]

run_stock = stock.run
run_portfolio = portfolio.run


def strategies_metadata() -> list[dict[str, Any]]:
    return [s.metadata() for s in STRATEGIES.values()]
