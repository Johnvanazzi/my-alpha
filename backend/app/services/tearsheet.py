"""pyfolio-style return analysis: rolling risk, drawdowns and monthly returns.

Built on pyfolio-reloaded's `timeseries` functions and empyrical, but returns
data instead of matplotlib figures so the frontend can chart it.
"""

import warnings
from typing import Any

import pandas as pd

from app.services.market_data import MarketDataError, clean_number
from app.services.portfolio_analytics import daily_rf, load_benchmark_returns, load_returns, resolve_risk_free

with warnings.catch_warnings():
    # pyfolio warns that zipline (an optional dependency) is missing.
    warnings.simplefilter("ignore")
    import empyrical as ep
    from pyfolio import timeseries

# pyfolio's default rolling window is 6 months of trading days.
DEFAULT_WINDOW = 126


def _date(value: Any) -> str | None:
    return None if value is None or pd.isna(value) else pd.Timestamp(value).date().isoformat()


def series_rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """[{date, col: value, ...}] rows for charts, skipping all-empty dates."""
    frame = frame.dropna(how="all")
    return [
        {"date": idx.date().isoformat(), **{col: clean_number(row[col]) for col in frame.columns}}
        for idx, row in frame.iterrows()
    ]


def underwater(returns: pd.Series) -> pd.Series:
    """Underwater plot: % below the running peak of cumulative returns."""
    cumulative = ep.cum_returns(returns, starting_value=1.0)
    return cumulative / cumulative.cummax() - 1


def monthly_returns(returns: pd.Series) -> list[dict[str, Any]]:
    monthly = ep.aggregate_returns(returns, "monthly")
    return [{"year": int(year), "month": int(month), "return": clean_number(value)} for (year, month), value in monthly.items()]


def tearsheet(
    weights: dict[str, float],
    period: str = "2y",
    benchmark: str | None = "SPY",
    window: int = DEFAULT_WINDOW,
    risk_free_rate: float | None = None,
) -> dict[str, Any]:
    _, _, returns = load_returns(weights, period)
    if window < 5:
        raise ValueError("window must be at least 5 trading days")
    if window >= len(returns):
        raise ValueError(
            f"The rolling window ({window} days) needs more history than the {len(returns)} days in this period. "
            "Pick a longer period or a shorter window."
        )
    rf = resolve_risk_free(risk_free_rate)
    excess = returns - daily_rf(rf)

    rolling = pd.DataFrame(
        {
            "volatility": timeseries.rolling_volatility(returns, window),
            "sharpe": timeseries.rolling_sharpe(excess, window),
        }
    )

    benchmark_error = None
    if benchmark:
        try:
            bench = load_benchmark_returns(benchmark, period, returns.index)
            aligned = pd.concat([returns, bench], axis=1, keys=["p", "b"]).dropna()
            rolling["beta"] = timeseries.rolling_beta(aligned["p"], aligned["b"], window)
            rolling["benchmark_volatility"] = timeseries.rolling_volatility(aligned["b"], window)
            rolling["benchmark_sharpe"] = timeseries.rolling_sharpe(aligned["b"] - daily_rf(rf), window)
        except (MarketDataError, ValueError) as exc:
            benchmark_error = f"Benchmark {benchmark.upper()} unavailable: {exc}"

    drawdowns = timeseries.gen_drawdown_table(returns, top=5)

    return {
        "period": period,
        "window": window,
        "benchmark": benchmark.upper() if benchmark else None,
        "benchmark_error": benchmark_error,
        "risk_free_rate": rf,
        "rolling": series_rows(rolling),
        "underwater": series_rows(underwater(returns).to_frame("drawdown")),
        "drawdowns": [
            {
                "net_drawdown": clean_number(row["Net drawdown in %"] / 100),
                "peak": _date(row["Peak date"]),
                "valley": _date(row["Valley date"]),
                "recovery": _date(row["Recovery date"]),
                "duration_days": clean_number(row["Duration"]),
            }
            for _, row in drawdowns.iterrows()
            if pd.notna(row["Peak date"])
        ],
        "monthly_returns": monthly_returns(returns),
    }
