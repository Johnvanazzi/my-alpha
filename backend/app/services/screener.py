"""Stock screener built on Yahoo Finance's screener endpoint (yf.screen).

Range filters are declared once in RANGE_FILTERS; `/screener/presets` exposes
that metadata so the frontend builds its filter form from it. Values are in
the units shown to the user (e.g. market cap in $B, ratios in percent) and
scaled here before reaching Yahoo.
"""

from dataclasses import asdict, dataclass
from typing import Any

import yfinance as yf
from pydantic import BaseModel, Field
from yfinance import EquityQuery

from app.services.market_data import MarketDataError, cached, clean_number, market_cache

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

# US exchanges other than OTC/pink sheets (Yahoo codes).
US_LISTED_EXCHANGES = ["NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS"]


@dataclass(frozen=True)
class RangeFilter:
    key: str
    label: str
    group: str
    field: str  # Yahoo screener field
    unit: str = ""  # shown next to the input: "%", "$B", "M", "x"
    scale: float = 1.0  # multiply the user's value by this before querying


RANGE_FILTERS: list[RangeFilter] = [
    # Valuation
    RangeFilter("market_cap", "Market cap", "Valuation", "intradaymarketcap", "$B", 1e9),
    RangeFilter("price", "Price", "Valuation", "intradayprice"),
    RangeFilter("pe", "P/E (TTM)", "Valuation", "peratio.lasttwelvemonths", "x"),
    RangeFilter("peg", "PEG (5y)", "Valuation", "pegratio_5y", "x"),
    RangeFilter("pb", "Price/Book", "Valuation", "pricebookratio.quarterly", "x"),
    RangeFilter("ps", "Price/Sales", "Valuation", "lastclosemarketcaptotalrevenue.lasttwelvemonths", "x"),
    RangeFilter("ev_ebitda", "EV/EBITDA", "Valuation", "lastclosetevebitda.lasttwelvemonths", "x"),
    # Profitability
    RangeFilter("roe", "Return on equity", "Profitability", "returnonequity.lasttwelvemonths", "%"),
    RangeFilter("roa", "Return on assets", "Profitability", "returnonassets.lasttwelvemonths", "%"),
    RangeFilter("gross_margin", "Gross margin", "Profitability", "grossprofitmargin.lasttwelvemonths", "%"),
    RangeFilter("ebitda_margin", "EBITDA margin", "Profitability", "ebitdamargin.lasttwelvemonths", "%"),
    RangeFilter("net_margin", "Net margin", "Profitability", "netincomemargin.lasttwelvemonths", "%"),
    # Growth
    RangeFilter("revenue_growth", "Revenue growth (1y)", "Growth", "totalrevenues1yrgrowth.lasttwelvemonths", "%"),
    RangeFilter("quarterly_revenue_growth", "Revenue growth (qtr YoY)", "Growth", "quarterlyrevenuegrowth.quarterly", "%"),
    RangeFilter("eps_growth", "EPS growth (1y)", "Growth", "epsgrowth.lasttwelvemonths", "%"),
    RangeFilter("ebitda_growth", "EBITDA growth (1y)", "Growth", "ebitda1yrgrowth.lasttwelvemonths", "%"),
    # Dividends
    RangeFilter("dividend_yield", "Dividend yield (fwd)", "Dividends", "forward_dividend_yield", "%"),
    RangeFilter("dividend_growth_years", "Years of dividend growth", "Dividends", "consecutive_years_of_dividend_growth_count"),
    # Risk & leverage
    RangeFilter("beta", "Beta (5y)", "Risk & leverage", "beta"),
    RangeFilter("debt_equity", "Debt/Equity", "Risk & leverage", "totaldebtequity.lasttwelvemonths", "%"),
    RangeFilter("net_debt_ebitda", "Net debt/EBITDA", "Risk & leverage", "netdebtebitda.lasttwelvemonths", "x"),
    RangeFilter("current_ratio", "Current ratio", "Risk & leverage", "currentratio.lasttwelvemonths", "x"),
    RangeFilter("short_float", "Short % of float", "Risk & leverage", "short_percentage_of_float.value", "%"),
    # Trading & performance
    RangeFilter("day_change", "Day change", "Trading", "percentchange", "%"),
    RangeFilter("change_52w", "52-week change", "Trading", "fiftytwowkpercentchange", "%"),
    RangeFilter("avg_volume", "Avg. volume (3M)", "Trading", "avgdailyvol3m", "M", 1e6),
]
RANGE_BY_KEY = {f.key: f for f in RANGE_FILTERS}

# Public sort key -> Yahoo screener field. Keys match result columns where possible.
SORT_FIELDS = {
    "market_cap": "intradaymarketcap",
    "price": "intradayprice",
    "change_percent": "percentchange",
    "change_52w": "fiftytwowkpercentchange",
    "pe": "peratio.lasttwelvemonths",
    "volume": "dayvolume",
    "avg_volume": "avgdailyvol3m",
    "dividend_yield": "forward_dividend_yield",
    "roe": "returnonequity.lasttwelvemonths",
    "revenue_growth": "totalrevenues1yrgrowth.lasttwelvemonths",
    "beta": "beta",
}


class Range(BaseModel):
    min: float | None = None
    max: float | None = None


class ScreenerFilters(BaseModel):
    region: str = "us"
    sector: str | None = None
    exclude_otc: bool = Field(default=True, description="US only: skip OTC / pink-sheet listings")
    ranges: dict[str, Range] = {}
    sort_by: str = "market_cap"
    sort_asc: bool = False
    limit: int = Field(default=50, ge=1, le=250)
    offset: int = Field(default=0, ge=0)


def filter_metadata() -> list[dict[str, Any]]:
    return [{k: v for k, v in asdict(f).items() if k not in ("field", "scale")} for f in RANGE_FILTERS]


def _build_query(f: ScreenerFilters) -> EquityQuery:
    clauses = [EquityQuery("eq", ["region", f.region.lower()])]
    if f.sector:
        clauses.append(EquityQuery("eq", ["sector", f.sector]))
    if f.exclude_otc and f.region.lower() == "us":
        clauses.append(EquityQuery("is-in", ["exchange", *US_LISTED_EXCHANGES]))

    for key, bounds in f.ranges.items():
        spec = RANGE_BY_KEY.get(key)
        if spec is None:
            raise ValueError(f"Unknown filter '{key}'")
        low = None if bounds.min is None else bounds.min * spec.scale
        high = None if bounds.max is None else bounds.max * spec.scale
        if low is not None and high is not None:
            if low > high:
                raise ValueError(f"{spec.label}: minimum is above maximum")
            clauses.append(EquityQuery("btwn", [spec.field, low, high]))
        elif low is not None:
            clauses.append(EquityQuery("gte", [spec.field, low]))
        elif high is not None:
            clauses.append(EquityQuery("lte", [spec.field, high]))

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
        "avg_volume": clean_number(q.get("averageDailyVolume3Month")),
        "trailing_pe": clean_number(q.get("trailingPE")),
        "forward_pe": clean_number(q.get("forwardPE")),
        "price_to_book": clean_number(q.get("priceToBook")),
        "eps_ttm": clean_number(q.get("epsTrailingTwelveMonths")),
        "dividend_yield": clean_number(q.get("dividendYield")),
        "fifty_two_week_change_percent": clean_number(q.get("fiftyTwoWeekChangePercent")),
        "vs_200d_percent": clean_number(q.get("twoHundredDayAverageChangePercent")),
        "analyst_rating": q.get("averageAnalystRating"),
    }


def _result(raw: dict[str, Any], offset: int, limit: int) -> dict[str, Any]:
    quotes = raw.get("quotes") or []
    return {
        "total": raw.get("total", len(quotes)),
        "offset": offset,
        "limit": limit,
        "results": [_row(q) for q in quotes[:limit] if q.get("symbol")],
    }


def run_screen(filters: ScreenerFilters) -> dict[str, Any]:
    if filters.sort_by not in SORT_FIELDS:
        raise ValueError(f"sort_by must be one of {', '.join(SORT_FIELDS)}")
    query = _build_query(filters)

    def load() -> dict[str, Any]:
        try:
            raw = yf.screen(
                query,
                sortField=SORT_FIELDS[filters.sort_by],
                sortAsc=filters.sort_asc,
                size=filters.limit,
                offset=filters.offset,
            )
        except Exception as exc:  # yfinance raises a mix of ValueError/HTTP errors
            raise MarketDataError(f"Screener request failed: {exc}") from exc
        return _result(raw, filters.offset, filters.limit)

    return cached(market_cache, ("screen", filters.model_dump_json()), load)


def run_preset(preset: str, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    if preset not in PRESETS:
        raise ValueError(f"preset must be one of {', '.join(PRESETS)}")

    def load() -> dict[str, Any]:
        try:
            # Predefined screens honour `size` with an offset (`count` is ignored then).
            raw = yf.screen(preset, size=limit, offset=offset)
        except Exception as exc:
            raise MarketDataError(f"Screener request failed: {exc}") from exc
        return _result(raw, offset, limit)

    return cached(market_cache, ("preset", preset, limit, offset), load)
