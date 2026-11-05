"""Stock screener built on Yahoo Finance's screener endpoint (yf.screen).

Range filters are declared once in RANGE_FILTERS; `/screener/presets` exposes
that metadata so the frontend builds its filter form from it. Values are in
the units shown to the user (e.g. market cap in $B, ratios in percent) and
scaled here before reaching Yahoo.

Brazilian security types (stocks, FIIs, BDRs) can't be told apart in Yahoo's query
language: they are all quoteType EQUITY and many FIIs carry no sector. They are
classified from B3 ticker conventions after the query instead (see `security_type`).
"""

import re
from dataclasses import asdict, dataclass
from typing import Any, Literal

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


# B3 security types, filterable when region is "br".
SECURITY_TYPES = {"stock": "Stocks", "fii": "FIIs", "bdr": "BDRs"}
SecurityType = Literal["stock", "fii", "bdr"]

# Standard-lot B3 tickers: 4-char root + share-class number (PETR4, HGLG11, AAPL34).
# Fractional (PETR4F) and other suffixed variants don't match and are dropped by a type filter.
_B3_TICKER = re.compile(r"^[A-Z0-9]{4}(\d{1,2})\.SA$")
_BDR_CLASSES = {"31", "32", "33", "34", "35", "39"}
# The 11 class mixes FIIs, units (share bundles like TAEE11), ETFs, Fiagros and infra funds;
# only the name separates them.
# Yahoo's FII names are inconsistent (typos, English, the administrator's "DTVM" name).
_FII_NAME = re.compile(r"imobili|imoliar|immobil|i mobili|\bimob\b|\bim$|\bFII\b|\bDTVM\b|real estate|shopping|fdo inv", re.I)
_NON_FII_FUND = re.compile(r"fiagro|[ií]ndice|\bETF\b|infra", re.I)
_COMPANY_NAME = re.compile(r"\bS\.?/?A\.?$|\bS\.A\.|\bLtd\b|\bLtda\b|companhia|participations", re.I)
_ANY_FUND = re.compile(r"fundo|\bfund\b|\bfic\b|[ií]ndice|\bETF\b", re.I)
# Upper bound on matches fetched for post-query type filtering (Yahoo pages are 250 rows).
TYPE_FILTER_MAX_ROWS = 5000
_YAHOO_PAGE = 250


def security_type(symbol: str | None, name: str | None) -> SecurityType | None:
    """B3 type from the ticker's share-class number, or None for anything else."""
    m = _B3_TICKER.match(symbol or "")
    if not m:
        return None
    cls, name = m.group(1), name or ""
    if cls in _BDR_CLASSES:
        return "bdr"
    if cls in {"3", "4", "5", "6", "7", "8"}:
        return "stock"
    if cls == "11":
        if _FII_NAME.search(name) and not _NON_FII_FUND.search(name):
            return "fii"
        if _COMPANY_NAME.search(name) and not _ANY_FUND.search(name):
            return "stock"  # unit
    return None


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
    security_types: list[SecurityType] = Field(default=[], description="Brazil only: keep these B3 types; empty = all")
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
        "security_type": security_type(q.get("symbol"), q.get("longName") or q.get("shortName")),
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


def _screen(query: EquityQuery, f: ScreenerFilters, size: int, offset: int) -> dict[str, Any]:
    try:
        return yf.screen(query, sortField=SORT_FIELDS[f.sort_by], sortAsc=f.sort_asc, size=size, offset=offset)
    except Exception as exc:  # yfinance raises a mix of ValueError/HTTP errors
        raise MarketDataError(f"Screener request failed: {exc}") from exc


def _typed_matches(query: EquityQuery, f: ScreenerFilters) -> list[dict[str, Any]]:
    """Every match of `query` (in sort order) whose B3 type is selected.

    Types are only known per row, so all pages are fetched and filtered here; the list
    is cached per query+sort so paging through it doesn't refetch.
    """
    wanted = set(f.security_types)

    def load() -> list[dict[str, Any]]:
        quotes: list[dict[str, Any]] = []
        for offset in range(0, TYPE_FILTER_MAX_ROWS, _YAHOO_PAGE):
            page = _screen(query, f, _YAHOO_PAGE, offset).get("quotes") or []
            quotes += page
            if len(page) < _YAHOO_PAGE:
                break
        seen: set[str] = set()
        out = []
        for q in quotes:
            sym = q.get("symbol")
            if sym and sym not in seen and security_type(sym, q.get("longName") or q.get("shortName")) in wanted:
                seen.add(sym)
                out.append(q)
        return out

    key = ("screen_typed", f.model_dump_json(exclude={"limit", "offset"}))
    return cached(market_cache, key, load)


def run_screen(filters: ScreenerFilters) -> dict[str, Any]:
    if filters.sort_by not in SORT_FIELDS:
        raise ValueError(f"sort_by must be one of {', '.join(SORT_FIELDS)}")
    query = _build_query(filters)

    if filters.security_types and filters.region.lower() == "br":
        matches = _typed_matches(query, filters)
        page = matches[filters.offset : filters.offset + filters.limit]
        return _result({"total": len(matches), "quotes": page}, filters.offset, filters.limit)

    def load() -> dict[str, Any]:
        return _result(_screen(query, filters, filters.limit, filters.offset), filters.offset, filters.limit)

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
