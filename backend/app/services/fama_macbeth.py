"""Fama-MacBeth (1973) two-pass regressions on the portfolio's holdings.

Pass 1 measures every holding's exposures on each day from the trailing window of
returns that ends the day before, so there is no look-ahead: its beta to the
benchmark and, optionally, price characteristics (momentum and volatility, z-scored
across the holdings that day).
Pass 2 runs one cross-sectional regression per day of the holdings' excess returns
on those exposures. The average of the daily slopes is the premium earned per unit
of exposure; its t-stat uses the time-series standard error of the slopes, plus a
Newey-West version that is robust to their autocorrelation.

A portfolio has few holdings, so each cross-section is tiny: read the results as a
description of what drove *these* holdings, not as proof that a factor is priced.
"""

import math
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats as scipy_stats

from app.services.market_data import MarketDataError, clean_number
from app.services.portfolio_analytics import TRADING_DAYS, daily_rf, load_benchmark_returns, load_returns, resolve_risk_free

FACTORS = ("beta", "momentum", "volatility")
DEFAULT_FACTORS = ("beta",)
DEFAULT_WINDOW = 63
MIN_PERIODS = 20


def _exposures(asset_returns: pd.DataFrame, market: pd.Series | None, factors: list[str], window: int) -> dict[str, pd.DataFrame]:
    """Exposure of each holding on each day, measured on the window ending the day before."""
    out: dict[str, pd.DataFrame] = {}
    if "beta" in factors:
        cov = pd.DataFrame({c: asset_returns[c].rolling(window).cov(market) for c in asset_returns.columns})
        out["beta"] = cov.div(market.rolling(window).var(), axis=0).shift(1)
    if "momentum" in factors:
        out["momentum"] = np.expm1(np.log1p(asset_returns).rolling(window).sum()).shift(1)
    if "volatility" in factors:
        out["volatility"] = (asset_returns.rolling(window).std() * math.sqrt(TRADING_DAYS)).shift(1)
    return out


def _zscore(frame: pd.DataFrame) -> pd.DataFrame:
    """Standardise across holdings per day, so a premium is per 1 cross-sectional standard deviation."""
    std = frame.std(axis=1, ddof=1).replace(0, np.nan)
    return frame.sub(frame.mean(axis=1), axis=0).div(std, axis=0)


def _premium(series: pd.Series) -> dict[str, Any]:
    """Fama-MacBeth mean of the daily slopes with plain and Newey-West t-stats."""
    t = len(series)
    mean = series.mean()
    se = series.std(ddof=1) / math.sqrt(t)
    t_stat = mean / se if se > 0 else None
    lags = int(4 * (t / 100) ** (2 / 9))
    hac = sm.OLS(series.to_numpy(), np.ones(t)).fit(cov_type="HAC", cov_kwds={"maxlags": lags})
    return {
        "mean_daily": clean_number(mean),
        "annualized": clean_number(mean * TRADING_DAYS),
        "std_error": clean_number(se),
        "t_stat": clean_number(t_stat),
        "p_value": clean_number(2 * scipy_stats.t.sf(abs(t_stat), t - 1)) if t_stat is not None else None,
        "t_stat_nw": clean_number(hac.tvalues[0]),
        "p_value_nw": clean_number(hac.pvalues[0]),
        "nw_lags": lags,
        "positive_share": clean_number((series > 0).mean()),
    }


def fama_macbeth(
    weights: dict[str, float],
    period: str = "2y",
    benchmark: str = "SPY",
    factors: list[str] | None = None,
    window: int = DEFAULT_WINDOW,
    risk_free_rate: float | None = None,
) -> dict[str, Any]:
    factors = [f for f in FACTORS if f in (factors or DEFAULT_FACTORS)]
    if not factors:
        raise ValueError(f"choose at least one factor: {', '.join(FACTORS)}")
    if window < 10:
        raise ValueError("window must be at least 10 trading days")

    weights, asset_returns, _ = load_returns(weights, period)
    n = asset_returns.shape[1]
    if n < len(factors) + 2:
        raise ValueError(
            f"Fama-MacBeth with {len(factors)} factor{'s' if len(factors) > 1 else ''} needs at least {len(factors) + 2} holdings "
            f"(the portfolio has {n}); drop a factor or add holdings"
        )

    market = None
    if "beta" in factors:
        market = load_benchmark_returns(benchmark, period, asset_returns.index)
        if market.notna().sum() < window + MIN_PERIODS:
            raise MarketDataError(f"Not enough history for the benchmark {benchmark.upper()}")
        # Days the benchmark didn't trade (holidays on its exchange) can't enter a beta.
        asset_returns = asset_returns[market.notna()]
        market = market.dropna()
    rf = resolve_risk_free(risk_free_rate)
    excess = asset_returns - daily_rf(rf)

    raw = _exposures(asset_returns, market, factors, window)
    exposures = {f: raw[f] if f == "beta" else _zscore(raw[f]) for f in factors}

    names = ["intercept", *factors]
    gammas, r2, residuals, fitted = [], [], [], []
    for day in excess.index:
        x = np.column_stack([np.ones(n), *[exposures[f].loc[day].to_numpy() for f in factors]])
        y = excess.loc[day].to_numpy()
        if not np.isfinite(x).all() or not np.isfinite(y).all() or np.linalg.matrix_rank(x) < x.shape[1]:
            continue
        coef = np.linalg.lstsq(x, y, rcond=None)[0]
        fit = x @ coef
        sst = ((y - y.mean()) ** 2).sum()
        gammas.append(pd.Series(coef, index=names, name=day))
        r2.append(1 - ((y - fit) ** 2).sum() / sst if sst > 0 else np.nan)
        residuals.append(pd.Series(y - fit, index=excess.columns, name=day))
        fitted.append(pd.Series(fit, index=excess.columns, name=day))

    if len(gammas) < MIN_PERIODS:
        raise ValueError(
            f"Only {len(gammas)} days left after the {window}-day estimation window; choose a longer period or a shorter window"
        )
    gamma = pd.DataFrame(gammas)
    resid = pd.DataFrame(residuals)
    fit = pd.DataFrame(fitted)
    used = excess.loc[gamma.index]

    w = pd.Series(weights)[excess.columns]
    last = gamma.index[-1]
    assets = [
        {
            "ticker": t,
            "weight": weights[t],
            "exposures": {f: clean_number(raw[f].at[last, t]) for f in factors},
            "excess_return": clean_number(used[t].mean() * TRADING_DAYS),
            "fitted_return": clean_number(fit[t].mean() * TRADING_DAYS),
            "alpha": clean_number(resid[t].mean() * TRADING_DAYS),
        }
        for t in excess.columns
    ]
    portfolio = {
        "exposures": {f: clean_number((raw[f].loc[last] * w).sum()) for f in factors},
        "excess_return": clean_number((used @ w).mean() * TRADING_DAYS),
        "fitted_return": clean_number((fit @ w).mean() * TRADING_DAYS),
        "alpha": clean_number((resid @ w).mean() * TRADING_DAYS),
    }

    cumulative = gamma.cumsum()
    return {
        "period": period,
        "benchmark": benchmark.upper() if "beta" in factors else None,
        "factors": factors,
        "window": window,
        "risk_free_rate": rf,
        "start": gamma.index[0].date().isoformat(),
        "end": last.date().isoformat(),
        "exposures_as_of": last.date().isoformat(),
        "periods": len(gamma),
        "holdings": n,
        "avg_r2": clean_number(np.nanmean(r2)),
        "premia": [{"name": name, **_premium(gamma[name])} for name in names],
        "cumulative": [
            {"date": idx.date().isoformat(), **{name: clean_number(row[name]) for name in names}}
            for idx, row in cumulative.iterrows()
        ],
        "assets": assets,
        "portfolio": portfolio,
    }
