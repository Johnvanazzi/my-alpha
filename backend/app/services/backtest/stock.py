"""Single-stock signal backtests (our own vectorised pandas engine).

Rules:
- Long or flat (position 0 or 1); the backtest starts flat.
- A signal is computed on bar t's close and executed at bar t+1's open, so a
  rule never trades on information it could not have had (no look-ahead).
- Every position change pays commission + slippage (in bps of the traded
  value), deducted from equity at the execution price.
- Indicators are computed on a longer warm-up history (see `WARMUP_PERIOD`) and
  trading starts on the first bar of the requested period.
"""

from collections.abc import Callable
from typing import Any

import numpy as np
import pandas as pd

from app.services import indicators as ind
from app.services.market_data import WARMUP_PERIOD, cached, clean_number, get_history, market_cache, validate_period, window_start
from app.services.scoring import SCORERS

from .results import build_result, years

# Bars kept when re-scoring the last bar: scorers look back at most ~21 bars,
# and warm-up NaNs only occur at the start of a series, so a short tail gives
# the same score as the full history and keeps the per-bar loop fast.
SCORE_TAIL = 60
# Re-scoring every bar costs ~4 ms, so the score strategy is limited to about 10 years.
MAX_SCORED_BARS = 2600
MIN_BARS = 20


def _hold(enter: pd.Series, exit: pd.Series) -> pd.Series:
    """Stateful long/flat signal: go long when `enter` fires, flat when `exit` fires."""
    state, out = 0.0, np.zeros(len(enter))
    for i, (e, x) in enumerate(zip(enter.to_numpy(), exit.to_numpy())):
        if state == 0 and e:
            state = 1.0
        elif state == 1 and x:
            state = 0.0
        out[i] = state
    return pd.Series(out, index=enter.index)


def buy_and_hold(df: pd.DataFrame, start: int, params: dict[str, Any]) -> pd.Series:
    return pd.Series(1.0, index=df.index)


def ma_crossover(df: pd.DataFrame, start: int, params: dict[str, Any]) -> pd.Series:
    average = ind.sma if params["ma_type"] == "sma" else ind.ema
    fast, slow = average(df, params["fast"])["value"], average(df, params["slow"])["value"]
    return (fast > slow).astype(float)


def rsi_mean_reversion(df: pd.DataFrame, start: int, params: dict[str, Any]) -> pd.Series:
    rsi = ind.rsi(df, params["period"])["value"]
    return _hold(rsi < params["buy_below"], rsi > params["sell_above"])


def macd_crossover(df: pd.DataFrame, start: int, params: dict[str, Any]) -> pd.Series:
    out = ind.macd(df, params["fast"], params["slow"], params["signal"])
    return (out["macd"] > out["signal"]).astype(float)


def summary_scores(df: pd.DataFrame, start: int) -> pd.Series:
    """Technical summary score (every indicator, default params, equal weights) as of each bar from `start`."""
    specs = [ind.parse_spec(i) for i in ind.REGISTRY if i in SCORERS]
    # Scorers only look at positions, and slicing a RangeIndex is much cheaper than a DatetimeIndex.
    bars = df.reset_index(drop=True)
    computed = [
        (indicator, params, {k: s.reset_index(drop=True) for k, s in indicator.compute(bars, *params).items()})
        for indicator, params in specs
    ]
    scores = np.full(len(df), np.nan)
    for t in range(max(start, 0), len(df)):
        lo = max(0, t + 1 - SCORE_TAIL)
        tail = bars.iloc[lo : t + 1]
        values = []
        for indicator, params, outputs in computed:
            result = SCORERS[indicator.id](tail, {k: s.iloc[lo : t + 1] for k, s in outputs.items()}, params)
            if result.score is not None:
                values.append(result.score)
        if values:
            scores[t] = sum(values) / len(values)
    return pd.Series(scores, index=df.index)


def score_threshold(df: pd.DataFrame, start: int, params: dict[str, Any]) -> pd.Series:
    # The signal for the first traded bar comes from the bar before it.
    first = max(start - 1, 0)
    if len(df) - first > MAX_SCORED_BARS:
        raise ValueError("The technical-score strategy supports periods up to 10 years")
    key = ("backtest_scores", df.attrs.get("ticker"), df.attrs.get("period"), len(df), first)
    scores = cached(market_cache, key, lambda: summary_scores(df, first))
    return _hold(scores >= params["enter_at"], scores <= params["exit_at"])


SIGNALS: dict[str, Callable[[pd.DataFrame, int, dict[str, Any]], pd.Series]] = {
    "buy_and_hold": buy_and_hold,
    "ma_crossover": ma_crossover,
    "rsi_mean_reversion": rsi_mean_reversion,
    "macd_crossover": macd_crossover,
    "score_threshold": score_threshold,
}


def simulate(window: pd.DataFrame, prev_close: float, position: np.ndarray, cost: float) -> dict[str, Any]:
    """Daily returns of a long/flat position traded at the open.

    `position[t]` is held from bar t's open to its close (and overnight into
    t+1). Returns are net of `cost` (a fraction of traded value).
    """
    o, c = window["Open"].to_numpy(float), window["Close"].to_numpy(float)
    prior_close = np.concatenate([[prev_close], c[:-1]])
    held_before = np.concatenate([[0.0], position[:-1]])
    traded = np.abs(position - held_before)

    gap = held_before * (o / prior_close - 1)
    intraday = position * (c / o - 1)
    returns = (1 + gap) * (1 - cost * traded) * (1 + intraday) - 1

    # Share of final equity lost to costs: each trade removes cost * traded of the equity at that moment.
    drag = 1 - float(np.prod(1 - cost * traded))
    return {"returns": pd.Series(returns, index=window.index), "traded": traded, "costs": drag}


def trade_list(window: pd.DataFrame, position: np.ndarray, cost: float) -> list[dict[str, Any]]:
    o, c, dates = window["Open"].to_numpy(float), window["Close"].to_numpy(float), window.index
    trades, entry = [], None
    held_before = 0.0
    for t, p in enumerate(position):
        if p > held_before:
            entry = t
        elif p < held_before and entry is not None:
            ret = (1 - cost) * (o[t] / o[entry]) * (1 - cost) - 1
            trades.append(_trade(dates, o, entry, t, o[t], ret, open_=False))
            entry = None
        held_before = p
    if entry is not None:
        last = len(position) - 1
        trades.append(_trade(dates, o, entry, last, c[last], (1 - cost) * (c[last] / o[entry]) - 1, open_=True))
    return trades


def _trade(dates: pd.DatetimeIndex, o: np.ndarray, entry: int, exit: int, exit_price: float, ret: float, open_: bool) -> dict[str, Any]:
    return {
        "entry_date": dates[entry].date().isoformat(),
        "entry_price": clean_number(o[entry]),
        "exit_date": None if open_ else dates[exit].date().isoformat(),
        "exit_price": clean_number(exit_price),
        "return": clean_number(ret),
        "bars_held": int(exit - entry + (1 if open_ else 0)),
        "open": open_,
    }


def run(
    ticker: str,
    strategy_id: str,
    params: dict[str, Any],
    period: str,
    benchmark: str | None,
    commission_bps: float,
    slippage_bps: float,
    rf: float,
) -> dict[str, Any]:
    validate_period(period)
    history_period = WARMUP_PERIOD[period]
    # get_history already treats non-positive prices as missing, so this also skips those bars.
    df = get_history(ticker, history_period).dropna(subset=["Open", "Close"]).copy()
    df.attrs.update(ticker=ticker.upper(), period=history_period)

    start_date = window_start(period, df.index[-1])
    start = 0 if start_date is None else int(df.index.searchsorted(start_date))
    window = df.iloc[start:]
    if len(window) < MIN_BARS:
        raise ValueError(f"Not enough price history for {ticker.upper()} in this period")

    signal = SIGNALS[strategy_id](df, start, params).fillna(0).clip(0, 1)
    # Decided on the previous bar's close, executed at this bar's open.
    decided = signal.shift(1)
    if strategy_id == "buy_and_hold":
        decided = decided.fillna(1.0)
    position = decided.fillna(0).iloc[start:].to_numpy(float)

    prev_close = float(df["Close"].iloc[start - 1]) if start > 0 else float(window["Open"].iloc[0])
    cost = (commission_bps + slippage_bps) / 10_000
    sim = simulate(window, prev_close, position, cost)
    buy_hold = simulate(window, prev_close, np.ones(len(window)), 0.0)["returns"]

    trades = trade_list(window, position, cost)
    wins = [t for t in trades if (t["return"] or 0) > 0]
    returns = sim["returns"]
    result = build_result(
        returns,
        buy_hold,
        rf,
        period,
        benchmark,
        {
            "trades": len(trades),
            "win_rate": len(wins) / len(trades) if trades else None,
            "exposure": clean_number(position.mean()),
            "turnover": clean_number(sim["traded"].sum() / years(returns)),
            "costs": clean_number(sim["costs"]),
        },
    )
    return {**result, "trades": trades}
