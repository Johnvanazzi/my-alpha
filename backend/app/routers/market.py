from typing import Annotated, Any

import pandas as pd
from fastapi import APIRouter, Query

from app.services import indicators as ind
from app.services import market_data as md
from app.services import forecasting, screener
from app.services.scoring import parse_weights, score_indicators

router = APIRouter(tags=["market"])


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
    weights: Annotated[
        list[str],
        Query(description='Score weights per indicator key or id, e.g. "macd:12,26,9=2" or "rsi=0.5". Default 1.'),
    ] = [],
) -> dict[str, Any]:
    specs = [ind.parse_spec(spec) for spec in indicators]
    md.validate_period(period, interval)

    df = md.get_history(ticker, md.WARMUP_PERIOD[period], interval)
    computed = [(indicator, params, indicator.compute(df, *params)) for indicator, params in specs]
    scores = score_indicators(df, computed, parse_weights(weights))

    start = md.window_start(period, df.index[-1])
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
                "key": ind.spec_key(indicator, params),
                "id": indicator.id,
                "label": ind.spec_label(indicator, params),
                "pane": indicator.pane,
                "params": params,
                "series": {name: values(series) for name, series in outputs.items()},
            }
            for indicator, params, outputs in computed
        ],
        "scores": scores,
    }


@router.get("/market/{ticker}/score")
def score(
    ticker: str,
    interval: str = "1d",
    indicators: Annotated[list[str], Query()] = [],
    weights: Annotated[list[str], Query()] = [],
) -> dict[str, Any]:
    """Indicator scores for the latest bar. Without `indicators`, every registered indicator with default parameters."""
    specs = [ind.parse_spec(spec) for spec in indicators] or [ind.parse_spec(i) for i in ind.REGISTRY]
    df = md.get_history(ticker, "2y" if interval == "1d" else "10y", interval)
    computed = [(indicator, params, indicator.compute(df, *params)) for indicator, params in specs]
    return {"ticker": ticker.upper(), "interval": interval, **score_indicators(df, computed, parse_weights(weights))}


@router.get("/market/{ticker}/arima")
def arima(
    ticker: str,
    horizon: int = Query(10, ge=1, le=forecasting.MAX_HORIZON, description="Trading days to forecast"),
    period: str = Query("2y", description="History used to fit the model"),
    order: str | None = Query(None, description='Fixed "p,d,q" order; omit for automatic selection'),
):
    parsed = None
    if order:
        try:
            parsed = tuple(int(v) for v in order.split(","))
        except ValueError as exc:
            raise ValueError('order must look like "p,d,q", e.g. "1,1,1"') from exc
        if len(parsed) != 3:
            raise ValueError('order must look like "p,d,q", e.g. "1,1,1"')
    md.validate_period(period)
    return forecasting.arima_forecast(ticker, horizon, period, parsed)


@router.get("/market/{ticker}/garch")
def garch(
    ticker: str,
    horizon: int = Query(10, ge=1, le=forecasting.MAX_HORIZON),
    period: str = "2y",
    dist: str = Query("t", description=f"Innovation distribution: {', '.join(forecasting.GARCH_DISTRIBUTIONS)}"),
):
    md.validate_period(period)
    return forecasting.garch_study(ticker, horizon, period, dist)


@router.get("/screener/presets")
def screener_presets():
    return {
        "presets": [{"id": k, "name": v} for k, v in screener.PRESETS.items()],
        "sectors": screener.SECTORS,
        "sort_fields": list(screener.SORT_FIELDS),
        "filters": screener.filter_metadata(),
    }


@router.get("/screener/presets/{preset}")
def run_preset(preset: str, limit: int = Query(50, ge=1, le=250), offset: int = Query(0, ge=0)):
    return screener.run_preset(preset, limit, offset)


@router.post("/screener")
def run_screen(filters: screener.ScreenerFilters):
    return screener.run_screen(filters)
