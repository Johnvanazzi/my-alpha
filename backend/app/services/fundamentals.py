"""Financial-report metrics derived from the income statement."""

from typing import Any

import pandas as pd

from app.services.market_data import clean_number, get_income_statement, get_profile

# Output metric -> candidate Yahoo line items, first match wins.
LINE_ITEMS = {
    "revenue": ["Total Revenue", "Operating Revenue"],
    "gross_profit": ["Gross Profit"],
    "ebitda": ["EBITDA", "Normalized EBITDA"],
    "operating_income": ["Operating Income"],
    "net_income": ["Net Income", "Net Income Common Stockholders"],
    "eps_basic": ["Basic EPS"],
    "eps_diluted": ["Diluted EPS"],
}

METRICS = [
    {"key": "revenue", "label": "Revenue", "kind": "currency"},
    {"key": "gross_profit", "label": "Gross Profit", "kind": "currency"},
    {"key": "ebitda", "label": "EBITDA", "kind": "currency"},
    {"key": "operating_income", "label": "Operating Income", "kind": "currency"},
    {"key": "net_income", "label": "Net Income", "kind": "currency"},
    {"key": "eps_basic", "label": "EPS (basic)", "kind": "per_share"},
    {"key": "eps_diluted", "label": "EPS (diluted)", "kind": "per_share"},
    {"key": "gross_margin", "label": "Gross Margin", "kind": "percent"},
    {"key": "ebitda_margin", "label": "EBITDA Margin", "kind": "percent"},
    {"key": "net_margin", "label": "Net Margin", "kind": "percent"},
    {"key": "revenue_growth", "label": "Revenue Growth", "kind": "percent"},
    {"key": "eps_growth", "label": "EPS Growth", "kind": "percent"},
]


def _pick(statement: pd.DataFrame, candidates: list[str]) -> pd.Series:
    for name in candidates:
        if name in statement.columns and statement[name].notna().any():
            return pd.to_numeric(statement[name], errors="coerce")
    return pd.Series(float("nan"), index=statement.index)


def _ratio(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator / denominator.where(denominator != 0)


def _growth(series: pd.Series) -> pd.Series:
    previous = series.shift(1)
    return (series - previous) / previous.abs().where(previous != 0)


def get_fundamentals(ticker: str, frequency: str = "annual") -> dict[str, Any]:
    statement = get_income_statement(ticker, frequency)
    data = pd.DataFrame({key: _pick(statement, names) for key, names in LINE_ITEMS.items()})

    # Yahoo sometimes returns an all-empty trailing period; drop it.
    data = data.dropna(how="all")

    data["gross_margin"] = _ratio(data["gross_profit"], data["revenue"])
    data["ebitda_margin"] = _ratio(data["ebitda"], data["revenue"])
    data["net_margin"] = _ratio(data["net_income"], data["revenue"])
    data["revenue_growth"] = _growth(data["revenue"])
    data["eps_growth"] = _growth(data["eps_diluted"].fillna(data["eps_basic"]))

    try:
        profile = get_profile(ticker)
    except Exception:
        profile = {"symbol": ticker.upper()}

    return {
        "ticker": ticker.upper(),
        "frequency": frequency,
        "currency": profile.get("currency"),
        "profile": {
            k: profile.get(k)
            for k in ("symbol", "name", "sector", "industry", "currency", "price", "market_cap", "summary")
        },
        "ttm": {
            "revenue": profile.get("revenue_ttm"),
            "gross_profit": profile.get("gross_profit_ttm"),
            "ebitda": profile.get("ebitda_ttm"),
            "eps": profile.get("trailing_eps"),
            "forward_eps": profile.get("forward_eps"),
            "trailing_pe": profile.get("trailing_pe"),
            "forward_pe": profile.get("forward_pe"),
            "gross_margin": profile.get("gross_margin"),
            "ebitda_margin": profile.get("ebitda_margin"),
            "profit_margin": profile.get("profit_margin"),
            "revenue_growth": profile.get("revenue_growth"),
            "earnings_growth": profile.get("earnings_growth"),
        },
        "metrics": METRICS,
        "periods": [
            {"period": idx.date().isoformat(), **{col: clean_number(row[col]) for col in data.columns}}
            for idx, row in data.iterrows()
        ],
    }
