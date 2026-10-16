"""Technical indicators.

Each indicator is registered with metadata (name, parameters, which chart
pane it belongs to) so the frontend can build its picker from `/indicators`.
To add an indicator: write a compute function returning {output: Series} and
add an `Indicator` entry to `REGISTRY`.
"""

from collections.abc import Callable
from dataclasses import asdict, dataclass, field

import pandas as pd


@dataclass(frozen=True)
class Param:
    name: str
    label: str
    default: int
    min: int = 1
    max: int = 500


@dataclass(frozen=True)
class Indicator:
    id: str
    name: str
    description: str
    # "price" overlays the price chart; anything else gets its own pane.
    pane: str
    params: list[Param]
    outputs: list[str]
    compute: Callable[..., dict[str, pd.Series]] = field(repr=False)

    def metadata(self) -> dict:
        data = asdict(self)
        data.pop("compute")
        return data


def sma(df: pd.DataFrame, period: int) -> dict[str, pd.Series]:
    return {"value": df["Close"].rolling(period, min_periods=period).mean()}


def ema(df: pd.DataFrame, period: int) -> dict[str, pd.Series]:
    return {"value": df["Close"].ewm(span=period, adjust=False, min_periods=period).mean()}


def bollinger(df: pd.DataFrame, period: int, std_dev: int) -> dict[str, pd.Series]:
    mid = df["Close"].rolling(period, min_periods=period).mean()
    std = df["Close"].rolling(period, min_periods=period).std(ddof=0)
    return {"upper": mid + std_dev * std, "middle": mid, "lower": mid - std_dev * std}


def rsi(df: pd.DataFrame, period: int) -> dict[str, pd.Series]:
    """Wilder's RSI."""
    delta = df["Close"].diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = gain / loss
    value = 100 - 100 / (1 + rs)
    # No losses in the window -> RSI is 100 by definition.
    value = value.where(loss != 0, 100.0).where(gain.notna())
    return {"value": value}


def macd(df: pd.DataFrame, fast: int, slow: int, signal: int) -> dict[str, pd.Series]:
    close = df["Close"]
    line = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
    line = line.where(close.expanding().count() >= slow)
    signal_line = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return {"macd": line, "signal": signal_line, "histogram": line - signal_line}


def volume(df: pd.DataFrame, period: int) -> dict[str, pd.Series]:
    vol = df["Volume"].astype(float)
    return {"volume": vol, "average": vol.rolling(period, min_periods=period).mean()}


def obv(df: pd.DataFrame, period: int) -> dict[str, pd.Series]:
    """On-Balance Volume: running total of volume, added on up closes and subtracted on down closes."""
    direction = df["Close"].diff().apply(lambda d: 1 if d > 0 else (-1 if d < 0 else 0))
    value = (direction * df["Volume"].astype(float)).cumsum()
    return {"obv": value, "signal": value.ewm(span=period, adjust=False, min_periods=period).mean()}


REGISTRY: dict[str, Indicator] = {
    ind.id: ind
    for ind in [
        Indicator(
            id="sma",
            name="Simple Moving Average",
            description="Arithmetic mean of the closing price over the last N bars.",
            pane="price",
            params=[Param("period", "Period", 50, 2, 400)],
            outputs=["value"],
            compute=sma,
        ),
        Indicator(
            id="ema",
            name="Exponential Moving Average",
            description="Moving average that weights recent prices more heavily.",
            pane="price",
            params=[Param("period", "Period", 20, 2, 400)],
            outputs=["value"],
            compute=ema,
        ),
        Indicator(
            id="bbands",
            name="Bollinger Bands",
            description="SMA with bands N standard deviations above and below.",
            pane="price",
            params=[Param("period", "Period", 20, 2, 200), Param("std_dev", "Std devs", 2, 1, 4)],
            outputs=["upper", "middle", "lower"],
            compute=bollinger,
        ),
        Indicator(
            id="volume",
            name="Volume",
            description="Traded volume per bar with its moving average.",
            pane="volume",
            params=[Param("period", "Average period", 20, 2, 200)],
            outputs=["volume", "average"],
            compute=volume,
        ),
        Indicator(
            id="obv",
            name="On-Balance Volume",
            description="Cumulative volume signed by the close's direction, with an EMA signal line. Rising OBV means volume flows in on up days.",
            pane="obv",
            params=[Param("period", "Signal EMA", 20, 2, 200)],
            outputs=["obv", "signal"],
            compute=obv,
        ),
        Indicator(
            id="rsi",
            name="Relative Strength Index",
            description="Momentum oscillator (0-100). Above 70 is often read as overbought, below 30 oversold.",
            pane="rsi",
            params=[Param("period", "Period", 14, 2, 100)],
            outputs=["value"],
            compute=rsi,
        ),
        Indicator(
            id="macd",
            name="MACD",
            description="Difference between a fast and slow EMA, with a signal line and histogram.",
            pane="macd",
            params=[Param("fast", "Fast", 12, 2, 100), Param("slow", "Slow", 26, 3, 200), Param("signal", "Signal", 9, 2, 100)],
            outputs=["macd", "signal", "histogram"],
            compute=macd,
        ),
    ]
}


def parse_spec(spec: str) -> tuple[Indicator, list[int]]:
    """Parse "macd:12,26,9" / "sma:50" / "rsi" into an indicator and its parameters."""
    ind_id, _, raw_params = spec.strip().lower().partition(":")
    indicator = REGISTRY.get(ind_id)
    if indicator is None:
        raise ValueError(f"Unknown indicator '{ind_id}'. Available: {', '.join(REGISTRY)}")

    values = [v for v in raw_params.split(",") if v.strip()] if raw_params else []
    if len(values) > len(indicator.params):
        raise ValueError(f"{indicator.id} takes at most {len(indicator.params)} parameter(s)")

    params: list[int] = []
    for i, param in enumerate(indicator.params):
        try:
            value = int(values[i]) if i < len(values) else param.default
        except ValueError as exc:
            raise ValueError(f"{indicator.id}: {param.name} must be an integer") from exc
        if not param.min <= value <= param.max:
            raise ValueError(f"{indicator.id}: {param.name} must be between {param.min} and {param.max}")
        params.append(value)

    if indicator.id == "macd" and params[0] >= params[1]:
        raise ValueError("macd: fast period must be smaller than slow period")
    return indicator, params



def spec_key(indicator: Indicator, params: list[int]) -> str:
    return f"{indicator.id}:{','.join(map(str, params))}"


def spec_label(indicator: Indicator, params: list[int]) -> str:
    return f"{indicator.id.upper()} ({', '.join(map(str, params))})"
