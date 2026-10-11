"""Thin, cached wrapper around yfinance.

Every call into Yahoo Finance goes through this module so caching, error
handling and data normalisation live in one place. yfinance is blocking, so
the routers that use it are plain `def` endpoints (FastAPI runs them in a
threadpool).
"""

import math
import threading
from collections.abc import Callable
from typing import Any, TypeVar

import pandas as pd
import yfinance as yf
from cachetools import TTLCache

from app.config import settings

T = TypeVar("T")

VALID_PERIODS = ("1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "10y", "max")
VALID_INTERVALS = ("1d", "1wk", "1mo")
RISK_FREE_TICKER = "^IRX"  # 13-week US Treasury bill yield, quoted in percent


class MarketDataError(Exception):
    """Raised when Yahoo Finance returns nothing usable for a request."""


market_cache: TTLCache = TTLCache(maxsize=512, ttl=settings.market_cache_ttl)
fundamentals_cache: TTLCache = TTLCache(maxsize=256, ttl=settings.fundamentals_cache_ttl)
_lock = threading.Lock()


def cached(cache: TTLCache, key: tuple, loader: Callable[[], T]) -> T:
    with _lock:
        if key in cache:
            return cache[key]
    value = loader()
    with _lock:
        cache[key] = value
    return value


def validate_period(period: str, interval: str = "1d") -> None:
    if period not in VALID_PERIODS:
        raise ValueError(f"period must be one of {', '.join(VALID_PERIODS)}")
    if interval not in VALID_INTERVALS:
        raise ValueError(f"interval must be one of {', '.join(VALID_INTERVALS)}")


def clean_number(value: Any) -> float | None:
    """Convert numpy/pandas scalars to JSON-safe floats (NaN/inf -> None)."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


# --- Prices -------------------------------------------------------------------


def get_history(ticker: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    """OHLCV history (split/dividend adjusted) indexed by naive dates."""
    validate_period(period, interval)
    ticker = ticker.upper()

    def load() -> pd.DataFrame:
        df = yf.Ticker(ticker).history(period=period, interval=interval, auto_adjust=True)
        if df.empty:
            raise MarketDataError(f"No price history found for {ticker}")
        df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        df.index = pd.DatetimeIndex(df.index).tz_localize(None)
        return df

    return cached(market_cache, ("history", ticker, period, interval), load)


def get_closes(tickers: list[str], period: str = "1y") -> pd.DataFrame:
    """Adjusted daily closes, one column per ticker."""
    validate_period(period)
    tickers = sorted({t.upper() for t in tickers})

    def load() -> pd.DataFrame:
        raw = yf.download(tickers, period=period, interval="1d", auto_adjust=True, progress=False, threads=True)
        if raw is None or raw.empty:
            raise MarketDataError(f"No price history found for {', '.join(tickers)}")
        closes = raw["Close"]
        if isinstance(closes, pd.Series):
            closes = closes.to_frame(tickers[0])
        closes.index = pd.DatetimeIndex(closes.index).tz_localize(None)
        missing = [t for t in tickers if t not in closes.columns or closes[t].dropna().empty]
        if missing:
            raise MarketDataError(f"No price history found for {', '.join(missing)}")
        return closes[tickers]

    return cached(market_cache, ("closes", tuple(tickers), period), load)


def get_risk_free_rate() -> float:
    """Latest annualised 13-week T-bill yield as a fraction (e.g. 0.041)."""

    def load() -> float:
        df = yf.Ticker(RISK_FREE_TICKER).history(period="5d")
        if df.empty:
            raise MarketDataError("Could not load the risk-free rate")
        return float(df["Close"].dropna().iloc[-1]) / 100

    return cached(market_cache, ("risk_free",), load)


# --- Company data -------------------------------------------------------------

_PROFILE_FIELDS = {
    "symbol": "symbol",
    "shortName": "name",
    "longName": "long_name",
    "sector": "sector",
    "industry": "industry",
    "country": "country",
    "currency": "currency",
    "exchange": "exchange",
    "quoteType": "quote_type",
    "marketCap": "market_cap",
    "currentPrice": "price",
    "regularMarketPrice": "regular_market_price",
    "previousClose": "previous_close",
    "fiftyTwoWeekHigh": "fifty_two_week_high",
    "fiftyTwoWeekLow": "fifty_two_week_low",
    "trailingPE": "trailing_pe",
    "forwardPE": "forward_pe",
    "trailingEps": "trailing_eps",
    "forwardEps": "forward_eps",
    "beta": "beta",
    "dividendYield": "dividend_yield",
    "totalRevenue": "revenue_ttm",
    "grossProfits": "gross_profit_ttm",
    "ebitda": "ebitda_ttm",
    "grossMargins": "gross_margin",
    "ebitdaMargins": "ebitda_margin",
    "operatingMargins": "operating_margin",
    "profitMargins": "profit_margin",
    "revenueGrowth": "revenue_growth",
    "earningsGrowth": "earnings_growth",
    "longBusinessSummary": "summary",
    "website": "website",
}


def get_profile(ticker: str) -> dict[str, Any]:
    ticker = ticker.upper()

    def load() -> dict[str, Any]:
        info = yf.Ticker(ticker).info or {}
        if not info or (info.get("quoteType") is None and info.get("shortName") is None):
            raise MarketDataError(f"Unknown ticker {ticker}")
        profile: dict[str, Any] = {}
        for source, target in _PROFILE_FIELDS.items():
            value = info.get(source)
            profile[target] = value if isinstance(value, str) or value is None else clean_number(value)
        profile["symbol"] = ticker
        if profile.get("price") is None:
            profile["price"] = profile.get("regular_market_price")
        return profile

    return cached(fundamentals_cache, ("profile", ticker), load)


def search(query: str, limit: int = 10) -> list[dict[str, Any]]:
    query = query.strip()
    if not query:
        return []

    def load() -> list[dict[str, Any]]:
        quotes = yf.Search(query, max_results=limit, news_count=0).quotes
        return [
            {
                "symbol": q.get("symbol"),
                "name": q.get("longname") or q.get("shortname"),
                "exchange": q.get("exchDisp") or q.get("exchange"),
                "type": q.get("typeDisp") or q.get("quoteType"),
                "sector": q.get("sector"),
                "industry": q.get("industry"),
            }
            for q in quotes
            if q.get("symbol")
        ]

    return cached(market_cache, ("search", query.lower(), limit), load)


def get_income_statement(ticker: str, frequency: str = "annual") -> pd.DataFrame:
    """Income statement with periods as rows (oldest first) and line items as columns."""
    if frequency not in ("annual", "quarterly"):
        raise ValueError("frequency must be 'annual' or 'quarterly'")
    ticker = ticker.upper()

    def load() -> pd.DataFrame:
        t = yf.Ticker(ticker)
        df = t.income_stmt if frequency == "annual" else t.quarterly_income_stmt
        if df is None or df.empty:
            raise MarketDataError(f"No financial statements found for {ticker}")
        return df.T.sort_index()

    return cached(fundamentals_cache, ("income", ticker, frequency), load)
