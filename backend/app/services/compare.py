"""Side-by-side comparison of 2-4 stocks: risk/return, benchmark relationship and fundamentals."""

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import numpy as np
import pandas as pd

from app.services import fundamentals, indicators
from app.services.fundamental_scoring import score_fundamentals
from app.services.market_data import MarketDataError, clean_number, get_closes, get_history, get_profile, window_start
from app.services.portfolio_analytics import TRADING_DAYS, daily_rf, resolve_risk_free, return_stats
from app.services.scoring import score_indicators

MIN_TICKERS, MAX_TICKERS = 2, 4
# Trailing returns shown regardless of the selected period.
TRAILING = [("1M", "1mo"), ("3M", "3mo"), ("6M", "6mo"), ("YTD", "ytd"), ("1Y", "1y"), ("3Y", "3y"), ("5Y", "5y")]
PROFILE_KEYS = (
    "name", "sector", "industry", "country", "currency", "exchange", "price", "market_cap", "trailing_pe", "forward_pe",
    "trailing_eps", "forward_eps", "beta", "dividend_yield", "revenue_ttm", "gross_profit_ttm", "ebitda_ttm",
    "gross_margin", "ebitda_margin", "operating_margin", "profit_margin", "revenue_growth", "earnings_growth",
    "fifty_two_week_high", "fifty_two_week_low",
)


def _history_period(period: str) -> str:
    # Long enough for the selected window and the 5Y trailing return.
    return period if period in ("10y", "max") else "5y"


def _benchmark_stats(returns: pd.Series, bench: pd.Series, rf: float) -> dict[str, float | None]:
    aligned = pd.concat([returns, bench], axis=1).dropna()
    if len(aligned) < 3 or aligned.iloc[:, 1].var() == 0:
        return {"beta": None, "correlation": None, "r_squared": None, "alpha": None, "tracking_error": None}
    r, b = aligned.iloc[:, 0], aligned.iloc[:, 1]
    beta = r.cov(b) / b.var()
    corr = r.corr(b)
    drf = daily_rf(rf)
    # Jensen's alpha, annualised: excess return not explained by beta to the benchmark.
    alpha = ((r - drf) - beta * (b - drf)).mean() * TRADING_DAYS
    return {
        "beta": clean_number(beta),
        "correlation": clean_number(corr),
        "r_squared": clean_number(corr**2),
        "alpha": clean_number(alpha),
        "tracking_error": clean_number((r - b).std() * np.sqrt(TRADING_DAYS)),
    }


def _trailing_returns(close: pd.Series) -> dict[str, float | None]:
    close = close.dropna()
    out: dict[str, float | None] = {}
    for label, period in TRAILING:
        start = window_start(period, close.index[-1])
        before = close[close.index <= start]
        # Need a price on/before the start date, otherwise the history is too short.
        out[label] = clean_number(close.iloc[-1] / before.iloc[-1] - 1) if len(before) else None
    return out


def _extras(ticker: str) -> dict[str, Any]:
    """Profile, annual fundamentals, technical and fundamental scores; each part may be missing (e.g. ETFs)."""
    try:
        profile = get_profile(ticker)
    except MarketDataError:
        profile = {}
    try:
        fund = fundamentals.get_fundamentals(ticker, "annual")
        fund_part = {"currency": fund["currency"], "periods": fund["periods"]}
    except (MarketDataError, ValueError, KeyError):
        fund_part = None
    try:
        df = get_history(ticker, "2y", "1d")
        specs = [indicators.parse_spec(i) for i in indicators.REGISTRY]
        computed = [(ind, params, ind.compute(df, *params)) for ind, params in specs]
        scores = score_indicators(df, computed)
        technical = {**scores["summary"], "indicators": [{k: s[k] for k in ("label", "score", "signal")} for s in scores["indicators"]]}
    except (MarketDataError, ValueError):
        technical = None
    try:
        scores = score_fundamentals(ticker)
        fundamental = {**scores["summary"], "groups": scores["groups"]}
    except (MarketDataError, ValueError, KeyError):
        fundamental = None
    return {
        "profile": {k: profile.get(k) for k in PROFILE_KEYS},
        "fundamentals": fund_part,
        "technical": technical,
        "fundamental_score": fundamental,
    }


def _rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return [
        {"date": idx.date().isoformat(), **{col: clean_number(v) for col, v in row.items()}}
        for idx, row in frame.dropna(how="all").iterrows()
    ]


def compare(
    tickers: list[str],
    period: str = "1y",
    benchmark: str | None = "SPY",
    risk_free_rate: float | None = None,
    window: int = 63,
) -> dict[str, Any]:
    tickers = list(dict.fromkeys(t.strip().upper() for t in tickers if t.strip()))
    if not MIN_TICKERS <= len(tickers) <= MAX_TICKERS:
        raise ValueError(f"Compare between {MIN_TICKERS} and {MAX_TICKERS} different tickers")
    if window < 5:
        raise ValueError("window must be at least 5 trading days")
    rf = resolve_risk_free(risk_free_rate)
    history = _history_period(period)

    full = get_closes(tickers, history)
    start = window_start(period, full.index[-1])
    closes = (full if start is None else full[full.index >= start]).ffill().dropna()
    if len(closes) < 3:
        raise MarketDataError("Not enough overlapping price history for these tickers")
    returns = closes.pct_change().dropna()

    bench_returns = None
    benchmark_error = None
    bench = benchmark.strip().upper() if benchmark else None
    if bench:
        try:
            bench_close = get_closes([bench], history)[bench]
            bench_returns = bench_close.pct_change().reindex(returns.index)
        except (MarketDataError, ValueError) as exc:
            benchmark_error = f"Benchmark {bench} unavailable: {exc}"

    with ThreadPoolExecutor(max_workers=MAX_TICKERS) as pool:
        extras = dict(zip(tickers, pool.map(_extras, tickers)))

    stocks = []
    for t in tickers:
        stats = return_stats(returns[t], rf)
        if bench_returns is not None:
            stats.update(_benchmark_stats(returns[t], bench_returns, rf))
        stocks.append({"ticker": t, "stats": stats, "trailing_returns": _trailing_returns(full[t]), **extras[t]})

    all_returns = returns.copy()
    if bench_returns is not None:
        all_returns[bench] = bench_returns
    corr = all_returns.corr()

    growth = (1 + all_returns.fillna(0)).cumprod() * 100
    drawdown = (1 + returns).cumprod()
    drawdown = drawdown / drawdown.cummax() - 1

    pairs = [(a, b) for i, a in enumerate(tickers) for b in tickers[i + 1 :]]
    if bench_returns is not None:
        pairs += [(t, bench) for t in tickers]
    rolling = pd.DataFrame({f"{a}~{b}": all_returns[a].rolling(window).corr(all_returns[b]) for a, b in pairs})

    relative = None
    if len(tickers) == 2:
        a, b = tickers
        relative = _rows((growth[a] / growth[b] * 100).to_frame("value"))

    return {
        "tickers": tickers,
        "benchmark": bench if bench_returns is not None else None,
        "benchmark_error": benchmark_error,
        "benchmark_stats": return_stats(bench_returns, rf) if bench_returns is not None else None,
        "period": period,
        "start": returns.index[0].date().isoformat(),
        "end": returns.index[-1].date().isoformat(),
        "observations": len(returns),
        "risk_free_rate": rf,
        "window": window,
        "stocks": stocks,
        "correlation": {
            "tickers": list(corr.columns),
            "matrix": [[clean_number(v) for v in row] for row in corr.to_numpy()],
        },
        "growth": _rows(growth),
        "drawdown": _rows(drawdown),
        "pairs": [{"key": f"{a}~{b}", "a": a, "b": b} for a, b in pairs],
        "rolling_correlation": _rows(rolling),
        "relative": relative,
    }
