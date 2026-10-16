"""Shape engine output into the API response shared by stock and portfolio backtests."""

from typing import Any

import pandas as pd

from app.services.market_data import WARMUP_PERIOD, MarketDataError
from app.services.portfolio_analytics import TRADING_DAYS, load_benchmark_returns, return_stats
from app.services.tearsheet import monthly_returns, series_rows, underwater


def years(returns: pd.Series) -> float:
    return max(len(returns), 1) / TRADING_DAYS


def build_result(
    returns: pd.Series,
    buy_hold: pd.Series,
    rf: float,
    period: str,
    benchmark: str | None,
    extra_stats: dict[str, Any],
) -> dict[str, Any]:
    """Stats, growth-of-100 curves, drawdowns and monthly returns for a strategy.

    `returns` and `buy_hold` are daily simple returns on the same index (the
    backtest window), net of costs for the strategy and gross for buy-and-hold.
    """
    curves = pd.DataFrame({"strategy": returns, "buy_hold": buy_hold})
    stats: dict[str, Any] = {
        "strategy": {**return_stats(returns, rf), **extra_stats},
        "buy_hold": return_stats(buy_hold, rf),
        "benchmark": None,
    }

    benchmark_error = None
    if benchmark:
        try:
            # Warm-up history so the first day has a return; dates before the benchmark existed stay empty.
            bench = load_benchmark_returns(benchmark, WARMUP_PERIOD[period], returns.index)
            first = bench.first_valid_index()
            if first is None:
                raise MarketDataError("no prices in the backtest window")
            curves["benchmark"] = bench.fillna(0).where(bench.index >= first)
            stats["benchmark"] = {"ticker": benchmark.upper(), **return_stats(bench, rf)}
        except (MarketDataError, ValueError) as exc:
            benchmark_error = f"Benchmark {benchmark.upper()} unavailable: {exc}"

    growth = (1 + curves).cumprod() * 100
    drawdown = pd.DataFrame({col: underwater(curves[col].dropna()) for col in curves.columns})

    return {
        "start": returns.index[0].date().isoformat(),
        "end": returns.index[-1].date().isoformat(),
        "observations": len(returns),
        "risk_free_rate": rf,
        "benchmark": benchmark.upper() if benchmark else None,
        "benchmark_error": benchmark_error,
        "stats": stats,
        "equity": series_rows(growth),
        "drawdown": series_rows(drawdown),
        "monthly_returns": monthly_returns(returns),
    }

