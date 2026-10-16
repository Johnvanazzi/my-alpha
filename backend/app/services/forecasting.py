"""Time-series studies for a single stock: ARIMA price forecasts and GARCH volatility.

ARIMA models daily log returns, not prices: prices trend and are not
stationary, while returns are. The forecast returns are then compounded onto
the last close to get the price path, and the bands come from the variance of
the *cumulative* return, which accounts for the correlation between forecast
errors at different horizons. The differencing order d (applied to returns,
almost always 0) comes from an ADF test and (p, q) from an AIC grid search,
unless the caller fixes the order. Forecasts are for at most MAX_HORIZON
trading days, with 80% / 95% bands; the central path is the median price
(exp of the expected log price), consistent with the lognormal bands.
A pseudo out-of-sample backtest fits the same order on data before the test
window, then re-filters with those fixed parameters at several past origins
(`results.apply`, no refit) and compares the forecast errors with a
naive random walk ("tomorrow = today"). A model that can't beat the random
walk has no forecasting edge, which is common for stock prices.

GARCH(1,1) models the conditional variance of daily returns: how volatility
clusters and decays back to its long-run level.
"""

import math
import warnings
from itertools import product
from typing import Any

import numpy as np
import pandas as pd

from app.services.market_data import cached, clean_number, get_history, market_cache

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from arch import arch_model
    from statsmodels.stats.diagnostic import acorr_ljungbox
    from scipy.stats import norm
    from statsmodels.tsa.arima.model import ARIMA
    from statsmodels.tsa.arima_process import arma2ma
    from statsmodels.tsa.stattools import adfuller

MAX_HORIZON = 20
MAX_PQ = 2
MAX_D = 1  # on returns; d = 1 already means the price is differenced twice
TRADING_DAYS = 252
HISTORY_BARS = 120
BACKTEST_ORIGINS = 12
GARCH_DISTRIBUTIONS = ("normal", "t", "skewt")


def _future_dates(last: pd.Timestamp, horizon: int) -> list[str]:
    # Business days only; exchange holidays are not excluded.
    return [d.date().isoformat() for d in pd.bdate_range(last + pd.Timedelta(days=1), periods=horizon)]


def _params(result) -> list[dict[str, Any]]:
    return [
        {"name": name, "value": clean_number(value), "p_value": clean_number(result.pvalues.get(name))}
        for name, value in result.params.items()
    ]


def _adf_pvalue(series: pd.Series) -> float:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # statsmodels 0.15 warns about a future return type
        return float(adfuller(series.dropna(), autolag="AIC")[1])


def _fit_arima(returns: pd.Series, order: tuple[int, int, int]):
    # The constant is the mean daily return (price drift); statsmodels rejects it once returns are differenced.
    trend = "c" if order[1] == 0 else "n"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return ARIMA(returns, order=order, trend=trend).fit()


def _cumulative_log_return(result, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """Mean and standard deviation of the cumulative log return 1..horizon days ahead.

    With ψ the MA(∞) weights of the returns model, the k-day cumulative forecast error is
    Σ_{j<k} (ψ_0 + … + ψ_j) ε_{T+k-j}, so its variance is σ² Σ_{j<k} (ψ_0 + … + ψ_j)².
    Adding up the per-day variances instead would ignore that forecast errors are correlated.
    """
    mean = np.cumsum(result.get_forecast(horizon).predicted_mean.to_numpy())
    ar = np.r_[1, -np.asarray(result.arparams)]
    for _ in range(result.model.k_diff):
        ar = np.convolve(ar, [1, -1])
    psi = arma2ma(ar, np.r_[1, np.asarray(result.maparams)], lags=horizon)
    variance = float(result.params["sigma2"]) * np.cumsum(np.cumsum(psi) ** 2)
    return mean, np.sqrt(variance)


def _backtest(y: pd.Series, order: tuple[int, int, int], horizon: int) -> dict[str, Any] | None:
    """h-step-ahead errors at past origins vs a random walk, with parameters estimated before the test window.

    `y` is the log price. At origin i the prices up to index i - 1 are known, i.e. returns[: i - 1].
    """
    returns = y.diff().iloc[1:].reset_index(drop=True)  # returns[j] is the move into price j + 1
    n = len(y)
    last_origin = n - horizon
    first_origin = max(last_origin - 120, n // 2)
    if last_origin <= first_origin:
        return None
    result = _fit_arima(returns.iloc[: first_origin - 1], order)
    origins = np.unique(np.linspace(first_origin, last_origin, BACKTEST_ORIGINS).astype(int))

    model_err, naive_err, hits = [], [], []
    for origin in origins:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            res = result.apply(returns.iloc[: origin - 1])
        start = float(np.exp(y.iloc[origin - 1]))
        predicted = start * float(np.exp(res.forecast(horizon).sum()))
        actual = float(np.exp(y.iloc[origin + horizon - 1]))
        model_err.append(predicted - actual)
        naive_err.append(start - actual)
        hits.append(np.sign(predicted - start) == np.sign(actual - start))

    def summary(errors: list[float]) -> dict[str, float | None]:
        e = np.array(errors)
        actual = np.exp(y.iloc[[o + horizon - 1 for o in origins]].to_numpy())
        return {"mape": clean_number(np.mean(np.abs(e) / actual)), "rmse": clean_number(np.sqrt(np.mean(e**2)))}

    return {
        "origins": len(origins),
        "horizon": horizon,
        "arima": {**summary(model_err), "hit_rate": clean_number(np.mean(hits))},
        "naive": summary(naive_err),
    }


def arima_forecast(
    ticker: str,
    horizon: int = 10,
    period: str = "2y",
    order: tuple[int, int, int] | None = None,
) -> dict[str, Any]:
    if not 1 <= horizon <= MAX_HORIZON:
        raise ValueError(f"horizon must be between 1 and {MAX_HORIZON} days")
    if order is not None and (any(v < 0 for v in order) or order[0] > 5 or order[1] > MAX_D or order[2] > 5):
        raise ValueError(f"order must satisfy 0 ≤ p ≤ 5, 0 ≤ d ≤ {MAX_D}, 0 ≤ q ≤ 5 (d differences the returns)")

    def load() -> dict[str, Any]:
        close = get_history(ticker, period, "1d")["Close"].dropna()
        if len(close) < 100:
            raise ValueError("ARIMA needs at least 100 daily prices; choose a longer period")
        y = pd.Series(np.log(close).to_numpy())  # log price; positional index keeps statsmodels quiet about dates
        returns = y.diff().iloc[1:].reset_index(drop=True)

        price_p = _adf_pvalue(y)
        returns_p = _adf_pvalue(returns)
        d = 0 if returns_p < 0.05 else 1

        candidates: list[dict[str, Any]] = []
        if order is None:
            best = None
            for p, q in product(range(MAX_PQ + 1), repeat=2):
                res = _fit_arima(returns, (p, d, q))
                candidates.append({"order": [p, d, q], "aic": clean_number(res.aic)})
                if best is None or res.aic < best.aic:
                    best, chosen = res, (p, d, q)
            result = best
            candidates.sort(key=lambda c: c["aic"] if c["aic"] is not None else math.inf)
        else:
            chosen = order
            result = _fit_arima(returns, chosen)

        # Compound the forecast returns onto the last close: price_k = last × exp(cumulative log return).
        last_price = float(close.iloc[-1])
        daily = result.get_forecast(horizon).predicted_mean.to_numpy()
        cum_mean, cum_std = _cumulative_log_return(result, horizon)

        def price(z: float) -> np.ndarray:
            return last_price * np.exp(cum_mean + z * cum_std)

        mean = price(0)
        z80, z95 = float(norm.ppf(0.90)), float(norm.ppf(0.975))
        resid = pd.Series(result.resid).iloc[chosen[1] :]
        lb_lags = min(10, len(resid) // 5)

        return {
            "ticker": ticker.upper(),
            "period": period,
            "horizon": horizon,
            "as_of": close.index[-1].date().isoformat(),
            "last_price": last_price,
            "order": list(chosen),
            "auto": order is None,
            "aic": clean_number(result.aic),
            "bic": clean_number(result.bic),
            "candidates": candidates[:6],
            "adf": {"price_p_value": clean_number(price_p), "returns_p_value": clean_number(returns_p), "d": d},
            "ljung_box_p_value": clean_number(acorr_ljungbox(resid, lags=[lb_lags], return_df=True)["lb_pvalue"].iloc[0]),
            "residual_std": clean_number(resid.std()),
            "params": _params(result),
            "expected_return": clean_number(mean[-1] / last_price - 1),
            "mean_daily_return": clean_number(np.expm1(returns.mean())),
            "history": [
                {"date": idx.date().isoformat(), "close": clean_number(v)} for idx, v in close.iloc[-HISTORY_BARS:].items()
            ],
            "forecast": [
                {
                    "date": date,
                    "daily_return": clean_number(np.expm1(daily[i])),
                    "cumulative_return": clean_number(np.expm1(cum_mean[i])),
                    "mean": clean_number(mean[i]),
                    "lower80": clean_number(price(-z80)[i]),
                    "upper80": clean_number(price(z80)[i]),
                    "lower95": clean_number(price(-z95)[i]),
                    "upper95": clean_number(price(z95)[i]),
                }
                for i, date in enumerate(_future_dates(close.index[-1], horizon))
            ],
            "backtest": _backtest(y, chosen, horizon),
        }

    return cached(market_cache, ("arima", ticker.upper(), horizon, period, order), load)


def garch_study(ticker: str, horizon: int = 10, period: str = "2y", dist: str = "t") -> dict[str, Any]:
    if not 1 <= horizon <= MAX_HORIZON:
        raise ValueError(f"horizon must be between 1 and {MAX_HORIZON} days")
    if dist not in GARCH_DISTRIBUTIONS:
        raise ValueError(f"dist must be one of {', '.join(GARCH_DISTRIBUTIONS)}")

    def load() -> dict[str, Any]:
        close = get_history(ticker, period, "1d")["Close"].dropna()
        returns = close.pct_change().dropna() * 100  # arch converges better on percent returns
        if len(returns) < 100:
            raise ValueError("GARCH needs at least 100 daily returns; choose a longer period")

        model = arch_model(returns, mean="Constant", vol="GARCH", p=1, q=1, dist=dist)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = model.fit(disp="off")

        params = result.params
        alpha, beta, omega = float(params["alpha[1]"]), float(params["beta[1]"]), float(params["omega"])
        persistence = alpha + beta
        unconditional_daily = math.sqrt(omega / (1 - persistence)) if persistence < 1 else None
        half_life = math.log(0.5) / math.log(persistence) if 0 < persistence < 1 else None

        variance = result.forecast(horizon=horizon, reindex=False).variance.iloc[-1].to_numpy()
        daily_vol = np.sqrt(variance) / 100
        dist_params = params[model.distribution.parameter_names()].to_numpy()
        q05 = float(model.distribution.ppf(0.05, dist_params))
        mu = float(params["mu"]) / 100
        cond_vol = result.conditional_volatility / 100 * math.sqrt(TRADING_DAYS)

        return {
            "ticker": ticker.upper(),
            "period": period,
            "horizon": horizon,
            "dist": dist,
            "as_of": close.index[-1].date().isoformat(),
            "params": _params(result),
            "persistence": clean_number(persistence),
            "half_life_days": clean_number(half_life),
            "unconditional_vol_annual": clean_number(unconditional_daily / 100 * math.sqrt(TRADING_DAYS)) if unconditional_daily else None,
            "current_vol_annual": clean_number(cond_vol.iloc[-1]),
            "realized_vol_annual": clean_number(returns.iloc[-21:].std() / 100 * math.sqrt(TRADING_DAYS)),
            # 1-day 95% Value at Risk from the next day's forecast volatility (as a positive loss).
            "var95_1d": clean_number(-(mu + q05 * daily_vol[0])),
            "aic": clean_number(result.aic),
            "conditional_vol": [
                {"date": idx.date().isoformat(), "vol": clean_number(v)} for idx, v in cond_vol.iloc[-TRADING_DAYS:].items()
            ],
            "forecast": [
                {"date": date, "vol_daily": clean_number(daily_vol[i]), "vol_annual": clean_number(daily_vol[i] * math.sqrt(TRADING_DAYS))}
                for i, date in enumerate(_future_dates(close.index[-1], horizon))
            ],
        }

    return cached(market_cache, ("garch", ticker.upper(), horizon, period, dist), load)
