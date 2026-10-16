"""Indicator scores on a 0-10 scale (0 = strongly bearish, 5 = neutral, 10 = strongly bullish).

Each scorer is a small decision tree evaluated on the latest bar. Besides the
score it records the path of decisions taken, so the UI can explain *why* an
indicator scored what it did. The summary score is a weighted average of the
individual scores; weights default to 1 and can be supplied per indicator key
(e.g. {"macd:12,26,9": 2}) so users can tune them later.

To score a new indicator, write `score_<id>(df, outputs, params) -> Score` and
register it in `SCORERS`.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from app.services.indicators import Indicator, spec_key, spec_label

BULLISH_AT = 6.5
BEARISH_AT = 3.5
# Bars to look back when checking for a "recent" crossover.
CROSS_LOOKBACK = 3
# Bars used to measure the direction (slope) of a line.
SLOPE_LOOKBACK = 5


@dataclass
class Score:
    score: float | None
    summary: str
    path: list[str] = field(default_factory=list)


def signal_for(score: float | None) -> str:
    if score is None:
        return "n/a"
    if score >= BULLISH_AT:
        return "bullish"
    if score <= BEARISH_AT:
        return "bearish"
    return "neutral"


# --- Helpers ------------------------------------------------------------------


def _last(series: pd.Series, back: int = 0) -> float | None:
    clean = series.dropna()
    if len(clean) <= back:
        return None
    return float(clean.iloc[-1 - back])


def _rising(series: pd.Series, bars: int = SLOPE_LOOKBACK) -> bool | None:
    now, before = _last(series), _last(series, bars)
    if now is None or before is None:
        return None
    return now > before


def _crossed(a: pd.Series, b: pd.Series | float, direction: str, within: int = CROSS_LOOKBACK) -> bool:
    """True if `a` crossed `b` (up or down) during the last `within` bars and is still on that side."""
    b = b if isinstance(b, pd.Series) else pd.Series(b, index=a.index)
    diff = (a - b).dropna()
    if len(diff) < within + 1:
        return False
    # A cross that has already reversed is not a signal.
    if (direction == "up" and diff.iloc[-1] <= 0) or (direction == "down" and diff.iloc[-1] >= 0):
        return False
    recent = diff.iloc[-(within + 1) :]
    for prev, cur in zip(recent.iloc[:-1], recent.iloc[1:]):
        if direction == "up" and prev <= 0 < cur:
            return True
        if direction == "down" and prev >= 0 > cur:
            return True
    return False


def _missing(what: str) -> Score:
    return Score(None, f"Not enough history to compute {what} for the latest bar.")


# --- Scorers ------------------------------------------------------------------


def score_moving_average(df: pd.DataFrame, out: dict[str, pd.Series], params: list[int]) -> Score:
    close, ma = df["Close"], out["value"]
    price, avg = _last(close), _last(ma)
    if price is None or avg is None:
        return _missing("the moving average")
    rising = _rising(ma)
    distance = price / avg - 1
    where = f"Price is {abs(distance):.1%} {'above' if distance >= 0 else 'below'} the average"
    trend = "rising" if rising else "falling"

    if _crossed(close, ma, "up"):
        return Score(8, "Price just crossed above the average: fresh bullish signal.", ["Crossed above recently"])
    if _crossed(close, ma, "down"):
        return Score(2, "Price just crossed below the average: fresh bearish signal.", ["Crossed below recently"])

    if distance >= 0:
        path = [where, f"Average is {trend}"]
        if rising:
            if distance > 0.10:
                return Score(7, "Uptrend, but price is stretched far above the average.", [*path, "Extended > 10%"])
            return Score(8.5, "Price above a rising average: healthy uptrend.", path)
        return Score(6, "Price above a falling average: possible bottoming, trend not confirmed.", path)

    path = [where, f"Average is {trend}"]
    if not rising:
        if distance < -0.10:
            return Score(3, "Downtrend, but price is stretched far below the average (bounce risk).", [*path, "Extended > 10%"])
        return Score(1.5, "Price below a falling average: established downtrend.", path)
    return Score(4, "Price below a rising average: pullback within a broader uptrend.", path)


def score_bollinger(df: pd.DataFrame, out: dict[str, pd.Series], params: list[int]) -> Score:
    price, upper, lower, middle = _last(df["Close"]), _last(out["upper"]), _last(out["lower"]), _last(out["middle"])
    if None in (price, upper, lower, middle) or upper == lower:
        return _missing("the bands")
    pct_b = (price - lower) / (upper - lower)
    rising = _rising(out["middle"])
    path = [f"%B = {pct_b:.2f}", f"Middle band is {'rising' if rising else 'falling'}"]

    if pct_b > 1:
        if rising:
            return Score(6, "Riding above the upper band in an uptrend: strong but stretched.", [*path, "Above upper band"])
        return Score(3, "Above the upper band without an uptrend: overbought.", [*path, "Above upper band"])
    if pct_b < 0:
        if rising:
            return Score(7, "Below the lower band while the trend is up: oversold, reversal candidate.", [*path, "Below lower band"])
        return Score(2, "Riding the lower band in a downtrend: weak.", [*path, "Below lower band"])
    if pct_b >= 0.5:
        return (
            Score(7, "Upper half of the bands with a rising middle band.", [*path, "Upper half"])
            if rising
            else Score(5.5, "Upper half of the bands, but the middle band is falling.", [*path, "Upper half"])
        )
    return (
        Score(5, "Lower half of the bands, but the middle band is rising.", [*path, "Lower half"])
        if rising
        else Score(3.5, "Lower half of the bands with a falling middle band.", [*path, "Lower half"])
    )


def score_rsi(df: pd.DataFrame, out: dict[str, pd.Series], params: list[int]) -> Score:
    rsi = out["value"]
    value = _last(rsi)
    if value is None:
        return _missing("RSI")
    rising = _rising(rsi)
    path = [f"RSI = {value:.1f}"]
    window = rsi.dropna().iloc[-(SLOPE_LOOKBACK + 1) : -1]

    if value < 70 and (window > 70).any():
        return Score(2.5, "RSI just fell back below 70: momentum rolling over from overbought.", [*path, "Exited overbought zone"])
    if value > 30 and (window < 30).any():
        return Score(8.5, "RSI just climbed back above 30: rebound from oversold.", [*path, "Exited oversold zone"])
    if value >= 80:
        return Score(2, "Extremely overbought: pullback risk is high.", [*path, "≥ 80"])
    if value >= 70:
        return Score(3.5, "Overbought: momentum is strong but stretched.", [*path, "70-80"])
    if value <= 20:
        return Score(8, "Extremely oversold: rebound potential.", [*path, "≤ 20"])
    if value <= 30:
        return Score(7, "Oversold: selling may be exhausted.", [*path, "20-30"])

    direction = "rising" if rising else "falling"
    if value >= 50:
        path += ["50-70", direction]
        if rising:
            return Score(7, "Bullish momentum (above 50) and improving.", path)
        return Score(6, "Bullish zone (above 50) but momentum is fading.", path)
    path += ["30-50", direction]
    if rising:
        return Score(4.5, "Bearish zone (below 50) but momentum is improving.", path)
    return Score(3.5, "Bearish momentum (below 50) and weakening.", path)


def score_macd(df: pd.DataFrame, out: dict[str, pd.Series], params: list[int]) -> Score:
    macd, signal, hist = out["macd"], out["signal"], out["histogram"]
    m, h = _last(macd), _last(hist)
    if m is None or h is None or _last(signal) is None:
        return _missing("MACD")
    hist_rising = _rising(hist, 2)
    zone = "above zero" if m > 0 else "below zero"

    # 1. Signal-line crossovers are the strongest events.
    if _crossed(macd, signal, "up"):
        if m < 0:
            return Score(8.5, "Bullish crossover below the zero line: early trend reversal.", ["Bullish signal crossover", zone])
        return Score(8, "Bullish crossover above the zero line: uptrend resuming.", ["Bullish signal crossover", zone])
    if _crossed(macd, signal, "down"):
        if m > 0:
            return Score(1.5, "Bearish crossover above the zero line: uptrend losing steam.", ["Bearish signal crossover", zone])
        return Score(2, "Bearish crossover below the zero line: downtrend resuming.", ["Bearish signal crossover", zone])

    # 2. Zero-line crossovers confirm a change of trend.
    if _crossed(macd, 0.0, "up"):
        return Score(7.5, "MACD crossed above zero: fast EMA now above slow EMA (trend turning up).", ["Zero-line cross up"])
    if _crossed(macd, 0.0, "down"):
        return Score(2.5, "MACD crossed below zero: fast EMA now below slow EMA (trend turning down).", ["Zero-line cross down"])

    # 3. No recent event: read position and histogram momentum.
    momentum = "histogram growing" if hist_rising else "histogram shrinking"
    if h > 0:
        path = ["MACD above signal", zone, momentum]
        if m > 0:
            return Score(8, "Uptrend with accelerating momentum.", path) if hist_rising else Score(6.5, "Uptrend, but momentum is slowing.", path)
        return Score(6.5, "Recovering below zero with improving momentum.", path) if hist_rising else Score(5.5, "Below zero; recovery is stalling.", path)
    path = ["MACD below signal", zone, momentum]
    if m < 0:
        return Score(3.5, "Downtrend, but selling momentum is easing.", path) if hist_rising else Score(2, "Downtrend with accelerating selling momentum.", path)
    return Score(4.5, "Above zero but below signal; pullback is easing.", path) if hist_rising else Score(3.5, "Above zero, but momentum is deteriorating.", path)


def score_volume(df: pd.DataFrame, out: dict[str, pd.Series], params: list[int]) -> Score:
    avg = _last(out["average"])
    recent = out["volume"].dropna().iloc[-SLOPE_LOOKBACK:]
    close = df["Close"].dropna()
    if avg is None or avg == 0 or len(recent) < SLOPE_LOOKBACK or len(close) <= SLOPE_LOOKBACK:
        return _missing("volume")
    ratio = float(recent.mean()) / avg
    change = float(close.iloc[-1] / close.iloc[-1 - SLOPE_LOOKBACK] - 1)
    up = change >= 0
    path = [f"Volume {ratio:.2f}× its average", f"Price {'up' if up else 'down'} {abs(change):.1%} over {SLOPE_LOOKBACK} bars"]

    if ratio >= 1.5:
        return Score(8.5, "Price rising on heavy volume: accumulation.", path) if up else Score(1.5, "Price falling on heavy volume: distribution.", path)
    if ratio >= 1.0:
        return Score(6.5, "Price rising on above-average volume.", path) if up else Score(3.5, "Price falling on above-average volume.", path)
    return Score(5.5, "Price rising on light volume: weak conviction.", path) if up else Score(4.5, "Pullback on light volume: little selling pressure.", path)


# Bars over which price and OBV trends are compared for divergences.
DIVERGENCE_LOOKBACK = 20
# Minimum price move over that window for a divergence to count.
DIVERGENCE_MIN_MOVE = 0.02


def score_obv(df: pd.DataFrame, out: dict[str, pd.Series], params: list[int]) -> Score:
    obv, signal = out["obv"], out["signal"]
    value, sig = _last(obv), _last(signal)
    close = df["Close"].dropna()
    if value is None or sig is None or len(close) <= DIVERGENCE_LOOKBACK:
        return _missing("OBV")
    price_change = float(close.iloc[-1] / close.iloc[-1 - DIVERGENCE_LOOKBACK] - 1)
    obv_before = _last(obv, DIVERGENCE_LOOKBACK)
    obv_up = obv_before is not None and value > obv_before
    window = f"{DIVERGENCE_LOOKBACK} bars"

    # 1. Divergences: volume flow disagrees with the price trend.
    if price_change > DIVERGENCE_MIN_MOVE and not obv_up:
        return Score(2.5, "Bearish divergence: price rose but OBV fell, so the rally lacks volume support.",
                     [f"Price +{price_change:.1%} over {window}", "OBV down", "Bearish divergence"])
    if price_change < -DIVERGENCE_MIN_MOVE and obv_up:
        return Score(7.5, "Bullish divergence: price fell but OBV rose, a sign of quiet accumulation.",
                     [f"Price {price_change:.1%} over {window}", "OBV up", "Bullish divergence"])

    # 2. Signal-line crossovers.
    if _crossed(obv, signal, "up"):
        return Score(7.5, "OBV just crossed above its signal line: buying volume is picking up.", ["Crossed above signal"])
    if _crossed(obv, signal, "down"):
        return Score(2.5, "OBV just crossed below its signal line: selling volume is picking up.", ["Crossed below signal"])

    # 3. Position vs signal and direction.
    rising = _rising(obv)
    path = ["OBV above signal" if value > sig else "OBV below signal", "rising" if rising else "falling", "Confirms price" if obv_up == (price_change >= 0) else "Mixed"]
    if value > sig:
        return Score(8, "OBV above its signal and rising: accumulation confirms the trend.", path) if rising else Score(6, "OBV above its signal but flattening.", path)
    return Score(2, "OBV below its signal and falling: distribution.", path) if not rising else Score(4, "OBV below its signal but turning up.", path)


SCORERS: dict[str, Callable[[pd.DataFrame, dict[str, pd.Series], list[int]], Score]] = {
    "sma": score_moving_average,
    "ema": score_moving_average,
    "bbands": score_bollinger,
    "rsi": score_rsi,
    "macd": score_macd,
    "volume": score_volume,
    "obv": score_obv,
}


def score_indicators(
    df: pd.DataFrame,
    computed: list[tuple[Indicator, list[int], dict[str, pd.Series]]],
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    weights = weights or {}
    items = []
    for indicator, params, outputs in computed:
        scorer = SCORERS.get(indicator.id)
        if scorer is None:
            continue
        key = spec_key(indicator, params)
        result = scorer(df, outputs, params)
        items.append(
            {
                "key": key,
                "id": indicator.id,
                "label": spec_label(indicator, params),
                "score": result.score,
                "signal": signal_for(result.score),
                "summary": result.summary,
                "path": result.path,
                "weight": float(weights.get(key, weights.get(indicator.id, 1.0))),
            }
        )

    return {"as_of": df.index[-1].date().isoformat(), "summary": weighted_summary(items), "indicators": items}


def weighted_summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Weighted average of the items' scores, ignoring missing scores and zero weights."""
    scored = [i for i in items if i["score"] is not None and i["weight"] > 0]
    total_weight = sum(i["weight"] for i in scored)
    summary = sum(i["score"] * i["weight"] for i in scored) / total_weight if total_weight else None
    return {"score": round(summary, 2) if summary is not None else None, "signal": signal_for(summary), "count": len(scored)}


def parse_weights(raw: list[str]) -> dict[str, float]:
    """Parse ["macd:12,26,9=2", "rsi=0.5"] into {key: weight}."""
    weights: dict[str, float] = {}
    for item in raw:
        key, sep, value = item.rpartition("=")
        if not sep or not key:
            raise ValueError(f"weight '{item}' must look like '<indicator>=<weight>'")
        try:
            weight = float(value)
        except ValueError as exc:
            raise ValueError(f"weight '{item}' is not a number") from exc
        if weight < 0:
            raise ValueError("weights must be non-negative")
        weights[key.strip().lower()] = weight
    return weights
