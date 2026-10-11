"""Stock screener built on Yahoo Finance's screener endpoint (yf.screen)."""

from typing import Any

import yfinance as yf
from pydantic import BaseModel, Field
from yfinance import EquityQuery

from app.services.market_data import MarketDataError, cached, market_cache, clean_number

SECTORS = [
    "Basic Materials",
    "Communication Services",
    "Consumer Cyclical",
    "Consumer Defensive",
    "Energy",
    "Financial Services",
    "Healthcare",
    "Industrials",
    "Real Estate",
    "Technology",
    "Utilities",
]

PRESETS = {
    "most_actives": "Most active",
    "day_gainers": "Day gainers",
    "day_losers": "Day losers",
    "growth_technology_stocks": "Growth technology",
    "undervalued_growth_stocks": "Undervalued growth",
    "undervalued_large_caps": "Undervalued large caps",
    "aggressive_small_caps": "Aggressive small caps",
    "small_cap_gainers": "Small cap gainers",
    "most_shorted_stocks": "Most shorted",
}

# Public sort key -> Yahoo screener field.
SORT_FIELDS = {
    "market_cap": "intradaymarketcap",
    "change_percent": "percentchange",
    "pe": "peratio.lasttwelvemonths",
    "volume": "dayvolume",
    "dividend_yield": "forward_dividend_yield",
}


class ScreenerFilters(BaseModel):
    region: str = "us"
    sector: str | None = None
    min_market_cap: float | None = Field(default=None, ge=0)
    max_market_cap: float | None = Field(default=None, ge=0)
    min_pe: float | None = None
    max_pe: float | None = None
    min_dividend_yield: float | None = Field(default=None, ge=0, description="Percent, e.g. 2 for 2%")
    min_revenue_growth: float | None = Field(default=None, description="1y revenue growth in percent")
    min_price: float | None = Field(default=None, ge=0)
    sort_by: str = "market_cap"
    sort_asc: bool = False
    limit: int = Field(default=50, ge=1, le=250)
    offset: int = Field(default=0, ge=0)


def _build_query(f: ScreenerFilters) -> EquityQuery:
    clauses = [EquityQuery("eq", ["region", f.region.lower()])]
    if f.sector:
        clauses.append(EquityQuery("eq", ["sector", f.sector]))

    ranges = [
        ("intradaymarketcap", f.min_market_cap, f.max_market_cap),
        ("peratio.lasttwelvemonths", f.min_pe, f.max_pe),
        ("forward_dividend_yield", f.min_dividend_yield, None),
        ("totalrevenues1yrgrowth.lasttwelvemonths", f.min_revenue_growth, None),
        ("intradayprice", f.min_price, None),
    ]
    for field, low, high in ranges:
        if low is not None and high is not None:
            clauses.append(EquityQuery("btwn", [field, low, high]))
        elif low is not None:
            clauses.append(EquityQuery("gte", [field, low]))
        elif high is not None:
            clauses.append(EquityQuery("lte", [field, high]))

    return clauses[0] if len(clauses) == 1 else EquityQuery("and", clauses)


def _row(q: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": q.get("symbol"),
        "name": q.get("longName") or q.get("shortName") or q.get("displayName"),
        "exchange": q.get("fullExchangeName") or q.get("exchange"),
        "currency": q.get("currency"),
        "price": clean_number(q.get("regularMarketPrice")),
        "change_percent": clean_number(q.get("regularMarketChangePercent")),
        "market_cap": clean_number(q.get("marketCap")),
        "volume": clean_number(q.get("regularMarketVolume")),
        "trailing_pe": clean_number(q.get("trailingPE")),
        "forward_pe": clean_number(q.get("forwardPE")),
        "eps_ttm": clean_number(q.get("epsTrailingTwelveMonths")),
        "dividend_yield": clean_number(q.get("dividendYield")),
        "fifty_two_week_change_percent": clean_number(q.get("fiftyTwoWeekChangePercent")),
    }


def _result(raw: dict[str, Any]) -> dict[str, Any]:
    quotes = raw.get("quotes") or []
    return {"total": raw.get("total", len(quotes)), "results": [_row(q) for q in quotes if q.get("symbol")]}


def run_screen(filters: ScreenerFilters) -> dict[str, Any]:
    if filters.sort_by not in SORT_FIELDS:
        raise ValueError(f"sort_by must be one of {', '.join(SORT_FIELDS)}")

    def load() -> dict[str, Any]:
        try:
            raw = yf.screen(
                _build_query(filters),
                sortField=SORT_FIELDS[filters.sort_by],
                sortAsc=filters.sort_asc,
                size=filters.limit,
                offset=filters.offset,
            )
        except Exception as exc:  # yfinance raises a mix of ValueError/HTTP errors
            raise MarketDataError(f"Screener request failed: {exc}") from exc
        return _result(raw)

    return cached(market_cache, ("screen", filters.model_dump_json()), load)


def run_preset(preset: str, limit: int = 50) -> dict[str, Any]:
    if preset not in PRESETS:
        raise ValueError(f"preset must be one of {', '.join(PRESETS)}")

    def load() -> dict[str, Any]:
        try:
            raw = yf.screen(preset, count=limit)
        except Exception as exc:
            raise MarketDataError(f"Screener request failed: {exc}") from exc
        return _result(raw)

    return cached(market_cache, ("preset", preset, limit), load)
