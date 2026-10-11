"""Portfolio statistics computed from daily adjusted closes.

Assumes a portfolio rebalanced daily to its target weights, so the portfolio's
daily return is the weighted sum of the assets' daily returns. This module is
the natural home for future work such as mean-variance optimisation.
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import numpy as np
import pandas as pd

from app.services.market_data import MarketDataError, clean_number, get_closes, get_profile, get_risk_free_rate

TRADING_DAYS = 252


def normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    total = sum(weights.values())
    if total <= 0:
        raise ValueError("weights must add up to more than 0")
    return {ticker: w / total for ticker, w in weights.items()}


def _daily_rf(annual_rf: float) -> float:
    return (1 + annual_rf) ** (1 / TRADING_DAYS) - 1


def _stats(returns: pd.Series, annual_rf: float) -> dict[str, float | None]:
    """Annualised statistics for a series of simple daily returns."""
    returns = returns.dropna()
    if len(returns) < 2:
        return {k: None for k in ("total_return", "annual_return", "annual_volatility", "sharpe_ratio", "sortino_ratio", "max_drawdown")}

    growth = (1 + returns).cumprod()
    years = len(returns) / TRADING_DAYS
    total_return = growth.iloc[-1] - 1
    annual_return = growth.iloc[-1] ** (1 / years) - 1

    excess = returns - _daily_rf(annual_rf)
    volatility = returns.std(ddof=1) * np.sqrt(TRADING_DAYS)
    sharpe = excess.mean() / excess.std(ddof=1) * np.sqrt(TRADING_DAYS) if excess.std(ddof=1) > 0 else None

    downside = np.sqrt((excess.clip(upper=0) ** 2).mean()) * np.sqrt(TRADING_DAYS)
    sortino = excess.mean() * TRADING_DAYS / downside if downside > 0 else None

    drawdown = growth / growth.cummax() - 1

    return {
        "total_return": clean_number(total_return),
        "annual_return": clean_number(annual_return),
        "annual_volatility": clean_number(volatility),
        "sharpe_ratio": clean_number(sharpe),
        "sortino_ratio": clean_number(sortino),
        "max_drawdown": clean_number(drawdown.min()),
    }


def analyze(
    weights: dict[str, float],
    period: str = "1y",
    risk_free_rate: float | None = None,
    benchmark: str | None = "SPY",
) -> dict[str, Any]:
    if not weights:
        raise ValueError("the portfolio has no holdings")

    weights = normalize_weights({t.upper(): w for t, w in weights.items()})
    tickers = list(weights)
    rf = get_risk_free_rate() if risk_free_rate is None else risk_free_rate

    closes = get_closes(tickers, period).ffill().dropna()
    if len(closes) < 3:
        raise MarketDataError("Not enough overlapping price history for these tickers")
    asset_returns = closes.pct_change().dropna()

    w = pd.Series(weights)[asset_returns.columns]
    portfolio_returns = asset_returns @ w

    cov = asset_returns.cov() * TRADING_DAYS
    portfolio_var = float(w @ cov @ w)
    risk_contribution = (w * (cov @ w)) / portfolio_var if portfolio_var > 0 else w * np.nan

    assets = []
    for ticker in tickers:
        assets.append(
            {
                "ticker": ticker,
                "weight": weights[ticker],
                "risk_contribution": clean_number(risk_contribution[ticker]),
                **_stats(asset_returns[ticker], rf),
            }
        )

    growth = pd.DataFrame({"portfolio": (1 + portfolio_returns).cumprod() * 100})
    benchmark_stats = None
    if benchmark:
        try:
            bench_close = get_closes([benchmark], period)[benchmark.upper()]
            bench_returns = bench_close.pct_change().reindex(portfolio_returns.index)
            benchmark_stats = {"ticker": benchmark.upper(), **_stats(bench_returns, rf)}
            growth["benchmark"] = (1 + bench_returns.fillna(0)).cumprod() * 100
            aligned = pd.concat([portfolio_returns, bench_returns], axis=1).dropna()
            bench_var = aligned.iloc[:, 1].var()
            benchmark_stats["portfolio_beta"] = clean_number(aligned.cov().iloc[0, 1] / bench_var) if bench_var > 0 else None
        except MarketDataError:
            benchmark_stats = None

    correlation = asset_returns.corr()

    return {
        "period": period,
        "start": asset_returns.index[0].date().isoformat(),
        "end": asset_returns.index[-1].date().isoformat(),
        "observations": len(asset_returns),
        "risk_free_rate": rf,
        "weights": weights,
        "portfolio": _stats(portfolio_returns, rf),
        "benchmark": benchmark_stats,
        "assets": assets,
        "correlation": {
            "tickers": list(correlation.columns),
            "matrix": [[clean_number(v) for v in row] for row in correlation.to_numpy()],
        },
        "growth": [
            {"date": idx.date().isoformat(), **{col: clean_number(row[col]) for col in growth.columns}}
            for idx, row in growth.iterrows()
        ],
    }


def composition(weights: dict[str, float]) -> dict[str, Any]:
    """Per-holding company profile plus allocation by sector and country."""
    tickers = list(weights)

    def fetch(ticker: str) -> dict[str, Any]:
        try:
            return get_profile(ticker)
        except MarketDataError:
            return {"symbol": ticker}

    with ThreadPoolExecutor(max_workers=8) as pool:
        profiles = dict(zip(tickers, pool.map(fetch, tickers)))

    holdings = [
        {
            "ticker": t,
            "weight": weights[t],
            "name": profiles[t].get("name"),
            "sector": profiles[t].get("sector") or "Unknown",
            "industry": profiles[t].get("industry"),
            "country": profiles[t].get("country") or "Unknown",
            "price": profiles[t].get("price"),
            "currency": profiles[t].get("currency"),
            "market_cap": profiles[t].get("market_cap"),
            "trailing_pe": profiles[t].get("trailing_pe"),
            "beta": profiles[t].get("beta"),
        }
        for t in tickers
    ]

    def group(key: str) -> list[dict[str, Any]]:
        totals: dict[str, float] = {}
        for h in holdings:
            totals[h[key]] = totals.get(h[key], 0) + h["weight"]
        return [{"name": k, "weight": v} for k, v in sorted(totals.items(), key=lambda kv: -kv[1])]

    return {"holdings": holdings, "by_sector": group("sector"), "by_country": group("country")}
