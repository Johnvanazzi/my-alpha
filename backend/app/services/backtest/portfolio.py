"""Portfolio allocation backtests with `bt`.

Each strategy is a bt algo stack: wait until the backtest window starts, then
rebalance on the first day and on a fixed schedule to weights from a weighing
algo. Estimates (volatility, covariance, HRP clusters) only use prices up to
the rebalance date, over a trailing lookback window loaded as warm-up history.
bt trades at the rebalance day's close. Commission + slippage are charged on
the traded value through bt's commission function.
"""

import warnings
from typing import Any

import bt
import numpy as np
import pandas as pd
from pypfopt import EfficientFrontier, HRPOpt, risk_models

from app.services.market_data import WARMUP_PERIOD, MarketDataError, clean_number, get_closes, validate_period, window_start
from app.services.portfolio_analytics import normalize_weights

from .results import build_result, years

INITIAL_CAPITAL = 100_000.0
MIN_BARS = 20
# Fewer return observations than this in the lookback -> fall back to equal weights.
MIN_ESTIMATION_BARS = 20

RUN_PERIOD = {"monthly": bt.algos.RunMonthly, "quarterly": bt.algos.RunQuarterly, "yearly": bt.algos.RunYearly}


class WeighOptimizer(bt.Algo):
    """Sets temp['weights'] with PyPortfolioOpt over a trailing lookback (min variance or HRP)."""

    def __init__(self, method: str, lookback: pd.DateOffset):
        super().__init__()
        self.method = method
        self.lookback = lookback

    def __call__(self, target) -> bool:
        selected = target.temp["selected"]
        prices = target.universe.loc[target.now - self.lookback : target.now, selected].dropna()
        returns = prices.pct_change().dropna()
        if len(selected) < 2 or len(returns) < MIN_ESTIMATION_BARS:
            target.temp["weights"] = {t: 1 / len(selected) for t in selected}
            return True
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if self.method == "hrp":
                weights = HRPOpt(returns=returns).optimize(linkage_method="single")
            else:
                cov = risk_models.CovarianceShrinkage(prices, frequency=252).ledoit_wolf()
                frontier = EfficientFrontier(None, cov, weight_bounds=(0, 1))
                frontier.min_volatility()
                weights = frontier.clean_weights()
        target.temp["weights"] = {t: float(w) for t, w in weights.items() if w > 1e-6}
        return True


def _weigh_algo(strategy_id: str, params: dict[str, Any], weights: dict[str, float]) -> bt.Algo:
    lookback = pd.DateOffset(months=params.get("lookback_months", 12))
    if strategy_id in ("portfolio_buy_and_hold", "fixed_weights"):
        return bt.algos.WeighSpecified(**weights)
    if strategy_id == "equal_weight":
        return bt.algos.WeighEqually()
    if strategy_id == "inverse_volatility":
        return bt.algos.WeighInvVol(lookback=lookback)
    if strategy_id == "min_variance":
        return WeighOptimizer("min_variance", lookback)
    if strategy_id == "hrp":
        return WeighOptimizer("hrp", lookback)
    raise ValueError(f"Unknown portfolio strategy '{strategy_id}'")


def _backtest(name: str, prices: pd.DataFrame, after: pd.Timestamp, run_when: bt.Algo, weigh: bt.Algo, cost: float) -> bt.backtest.Result:
    strategy = bt.Strategy(
        name,
        [bt.algos.RunAfterDate(after), run_when, bt.algos.SelectAll(), weigh, bt.algos.Rebalance()],
    )
    test = bt.Backtest(
        strategy,
        prices,
        initial_capital=INITIAL_CAPITAL,
        commissions=lambda quantity, price: abs(quantity) * price * cost,
        integer_positions=False,
        progress_bar=False,
    )
    return bt.run(test)


def _rebalances(result: bt.backtest.Result, window: pd.DatetimeIndex) -> tuple[list[dict[str, Any]], float]:
    """Rebalance log (weights after trading, traded fraction of the portfolio, fees) and total traded fraction."""
    test = result.backtests["strategy"]
    values, fees, weights = test.strategy.values, test.strategy.fees, test.security_weights
    transactions = result.get_transactions()

    out, total = [], 0.0
    if transactions.empty:
        return out, total
    traded = (transactions["price"] * transactions["quantity"]).abs().groupby(level=0).sum()
    for date, value in traded.items():
        if date not in window:
            continue
        fraction = float(value / values.loc[date])
        total += fraction
        row = weights.loc[date]
        out.append(
            {
                "date": pd.Timestamp(date).date().isoformat(),
                "turnover": clean_number(fraction),
                "cost": clean_number(fees.loc[date] / (values.loc[date] + fees.loc[date])),
                "weights": {t: clean_number(w) for t, w in row.items() if w > 1e-6},
            }
        )
    return out, total


def _cost_drag(test: bt.Backtest, window: pd.DatetimeIndex) -> float:
    """Share of final equity lost to costs (bt's values are after that day's fees)."""
    fees = test.strategy.fees.reindex(window).fillna(0)
    values = test.strategy.values.reindex(window)
    paid = fees > 0
    return 1 - float(np.prod(1 - fees[paid] / (values[paid] + fees[paid])))


def run(
    weights: dict[str, float],
    strategy_id: str,
    params: dict[str, Any],
    period: str,
    benchmark: str | None,
    commission_bps: float,
    slippage_bps: float,
    rf: float,
) -> dict[str, Any]:
    validate_period(period)
    if not weights:
        raise ValueError("the portfolio has no holdings")
    weights = normalize_weights({t.upper(): w for t, w in weights.items()})
    if strategy_id in ("min_variance", "hrp") and len(weights) < 2:
        raise ValueError("This strategy needs at least two holdings")

    prices = get_closes(list(weights), WARMUP_PERIOD[period])
    prices = prices.ffill().dropna()  # get_closes already treats non-positive prices as missing
    if len(prices) < MIN_BARS:
        raise MarketDataError("Not enough overlapping price history for these tickers")

    # Trade from the first bar of the period, but not before a full lookback of history exists.
    first_allowed = window_start(period, prices.index[-1])
    if "lookback_months" in params:
        warm = prices.index[0] + pd.DateOffset(months=params["lookback_months"])
        first_allowed = warm if first_allowed is None else max(first_allowed, warm)
    start = 1 if first_allowed is None else max(int(prices.index.searchsorted(first_allowed)), 1)
    window = prices.index[start:]
    if len(window) < MIN_BARS:
        raise ValueError("Not enough price history in this period (after the lookback window) to backtest")
    after = prices.index[start - 1]

    if strategy_id == "portfolio_buy_and_hold":
        run_when: bt.Algo = bt.algos.RunOnce()
    else:
        run_when = bt.algos.Or([bt.algos.RunOnce(), RUN_PERIOD[params["rebalance"]]()])

    cost = (commission_bps + slippage_bps) / 10_000
    result = _backtest("strategy", prices, after, run_when, _weigh_algo(strategy_id, params, weights), cost)
    test = result.backtests["strategy"]
    reference = _backtest("buy_hold", prices, after, bt.algos.RunOnce(), bt.algos.WeighSpecified(**weights), 0.0).backtests["buy_hold"]

    returns = test.strategy.prices.pct_change().reindex(window).fillna(0)
    buy_hold = reference.strategy.prices.pct_change().reindex(window).fillna(0)

    rebalances, traded = _rebalances(result, window)
    # Win rate: share of holding periods between rebalances that made money.
    growth = (1 + returns).cumprod()
    marks = [pd.Timestamp(r["date"]) for r in rebalances]
    period_returns = []
    for i, date in enumerate(marks):
        end = marks[i + 1] if i + 1 < len(marks) else window[-1]
        if end > date:
            period_returns.append(growth.loc[end] / growth.loc[date] - 1)

    values = test.strategy.values.reindex(window)
    exposure = 1 - (test.strategy.cash.reindex(window) / values).clip(0, 1)

    output = build_result(
        returns,
        buy_hold,
        rf,
        period,
        benchmark,
        {
            "trades": len(rebalances),
            "win_rate": clean_number(np.mean([r > 0 for r in period_returns])) if period_returns else None,
            "exposure": clean_number(exposure.mean()),
            "turnover": clean_number(traded / years(returns)),
            "costs": clean_number(_cost_drag(test, window)),
        },
    )
    return {**output, "tickers": list(weights), "rebalances": rebalances}
