"""Asset-type categories for holdings: Stocks, FIIs, BDRs, ETFs... from B3 ticker conventions.

The share-class number settles most B3 tickers on its own (PETR4 is a stock, AAPL34 a BDR).
The 11 class mixes FIIs, units, ETFs, Fiagros and infra funds, so those are told apart
by the name Yahoo reports (see `screener.security_type`). Non-B3 tickers are "International".
"""

import re
from concurrent.futures import ThreadPoolExecutor

from app.services.market_data import MarketDataError, get_profile
from app.services.screener import SECURITY_TYPES, security_type

INTERNATIONAL = "International"
OTHER = "Other"

# Fund flavours in the 11 class that aren't FIIs. Yahoo garbles accents ("�NDICE"), hence ".ndice".
_ETF_NAME = re.compile(r"\bETF\b|ishares|.ndice\b", re.I)
_FIAGRO_NAME = re.compile(r"fiagro", re.I)
_INFRA_NAME = re.compile(r"infra", re.I)


def _name(ticker: str) -> str:
    try:
        profile = get_profile(ticker)
    except MarketDataError:
        return ""
    # Short names often carry the type ("FII HGLG"); long names end in "S.A." for units.
    return f"{profile.get('name') or ''} {profile.get('long_name') or ''}".strip()


def _needs_name(ticker: str) -> bool:
    return ticker.endswith(".SA") and security_type(ticker, "") is None


def category(ticker: str, name: str = "") -> str:
    ticker = ticker.upper()
    if not ticker.endswith(".SA"):
        return INTERNATIONAL
    kind = security_type(ticker, name)
    if kind:
        return SECURITY_TYPES[kind]
    if _FIAGRO_NAME.search(name):
        return "Fiagros"
    if _ETF_NAME.search(name):
        return "ETFs"
    if _INFRA_NAME.search(name):
        return "FI-Infra"
    return OTHER


def categorize(tickers: list[str]) -> dict[str, str]:
    """Category per ticker; only ambiguous B3 tickers cost a (cached) profile lookup."""
    tickers = sorted({t.upper() for t in tickers})
    ambiguous = [t for t in tickers if _needs_name(t)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        names = dict(zip(ambiguous, pool.map(_name, ambiguous)))
    return {t: category(t, names.get(t, "")) for t in tickers}
