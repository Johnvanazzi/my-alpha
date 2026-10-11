from typing import Annotated, Any

import pandas as pd
from fastapi import APIRouter, Query

from app.services import indicators as ind
from app.services import market_data as md
from app.services import screener

router = APIRouter(tags=["market"])

# Indicators need history before the visible window (e.g. SMA 200), so we load
# a longer period and trim back to the requested one.
_WARMUP_PERIOD = {
    "1mo": "1y",
    "3mo": "2y",
    "6mo": "2y",
    "ytd": "2y",
    "1y": "2y",
    "2y": "5y",
    "5y": "10y",
    "10y": "max",
    "max": "max",
}


def _window_start(period: str, last: pd.Timestamp) -> pd.Timestamp | None:
    if period == "max":
        return None
    if period == "ytd":
        return pd.Timestamp(year=last.year, month=1, day=1)
    if period.endswith("mo"):
        return last - pd.DateOffset(months=int(period[:-2]))
    return last - pd.DateOffset(years=int(period[:-1]))


@router.get("/market/search")
def search(q: Annotated[str, Query(min_length=1, max_length=50)], limit: int = Query(10, ge=1, le=25)):
    return md.search(q, limit)


@router.get("/market/indicators")
def list_indicators():
    return [indicator.metadata() for indicator in ind.REGISTRY.values()]


@router.get("/market/risk-free-rate")
def risk_free_rate():
    return {"ticker": md.RISK_FREE_TICKER, "rate": md.get_risk_free_rate()}


@router.get("/market/{ticker}/profile")
def profile(ticker: str):
    return md.get_profile(ticker)


@router.get("/market/{ticker}/chart")
def chart(
    ticker: str,
    period: str = "1y",
    interval: str = "1d",
    indicators: Annotated[
        list[str],
        Query(description='Indicator specs such as "sma:50", "rsi:14", "macd:12,26,9", "volume:20"'),
    ] = [],
) -> dict[str, Any]:
    specs = [ind.parse_spec(spec) for spec in indicators]
    md.validate_period(period, interval)

    df = md.get_history(ticker, _WARMUP_PERIOD[period], interval)
    computed = [(indicator, params, indicator.compute(df, *params)) for indicator, params in specs]

    start = _window_start(period, df.index[-1])
    mask = df.index >= start if start is not None else slice(None)
    visible = df.loc[mask]

    def values(series: pd.Series) -> list[float | None]:
        return [md.clean_number(v) for v in series.loc[mask]]

    return {
        "ticker": ticker.upper(),
        "period": period,
        "interval": interval,
        "candles": [
            {
                "time": idx.date().isoformat(),
                "open": md.clean_number(row.Open),
                "high": md.clean_number(row.High),
                "low": md.clean_number(row.Low),
                "close": md.clean_number(row.Close),
                "volume": md.clean_number(row.Volume),
            }
            for idx, row in zip(visible.index, visible.itertuples())
        ],
        "indicators": [
            {
                "key": f"{indicator.id}:{','.join(map(str, params))}",
                "id": indicator.id,
                "label": f"{indicator.id.upper()} ({', '.join(map(str, params))})",
                "pane": indicator.pane,
                "params": params,
                "series": {name: values(series) for name, series in outputs.items()},
            }
            for indicator, params, outputs in computed
        ],
    }


@router.get("/screener/presets")
def screener_presets():
    return {
        "presets": [{"id": k, "name": v} for k, v in screener.PRESETS.items()],
        "sectors": screener.SECTORS,
        "sort_fields": list(screener.SORT_FIELDS),
    }


@router.get("/screener/presets/{preset}")
def run_preset(preset: str, limit: int = Query(50, ge=1, le=250)):
    return screener.run_preset(preset, limit)


@router.post("/screener")
def run_screen(filters: screener.ScreenerFilters):
    return screener.run_screen(filters)
