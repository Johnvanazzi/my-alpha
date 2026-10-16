"""Fundamental scores on a 0-10 scale (0 = weak / expensive, 5 = neutral, 10 = strong / cheap).

Same idea as `scoring.py` for indicators: each factor is a small decision tree
that records the decisions it took, so the UI can explain the score. Factors
belong to three groups (growth, quality, valuation) and the summary is the
weighted average of all factor scores; weights default to 1 and are keyed by
factor id (e.g. {"valuation": 2}).

Inputs are Yahoo's TTM figures (`get_profile`) plus the annual income
statement, balance sheet and cash flow. Thresholds are sector-agnostic rules of
thumb, except that leverage and cash-flow factors are skipped for banks and
insurers, whose balance sheets don't fit them.

To add a factor, write `score_<id>(facts) -> Score` and register it in `FACTORS`.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any

import pandas as pd

from app.services.market_data import MarketDataError, get_profile, get_split_adjusted_history, get_statement
from app.services.scoring import Score, signal_for, weighted_summary

# Years used for growth rates (CAGR) and trend comparisons.
TREND_YEARS = 3
# Minimum fiscal years with positive EPS to compare the P/E with its own history.
MIN_HISTORY_POINTS = 3
FINANCIAL_SECTORS = ("Financial Services",)

GROUPS = {"growth": "Growth", "quality": "Quality", "valuation": "Valuation"}


@dataclass
class Facts:
    """Everything the scorers read, gathered once per ticker."""

    profile: dict[str, Any]
    income: pd.DataFrame
    balance: pd.DataFrame
    cashflow: pd.DataFrame
    quarterly_income: pd.DataFrame
    quarterly_cashflow: pd.DataFrame
    ticker: str

    def ttm(self, key: str) -> float | None:
        return self.profile.get(key)

    @property
    def is_financial(self) -> bool:
        return self.profile.get("sector") in FINANCIAL_SECTORS

    @property
    def statements_match_price(self) -> bool:
        """Whether annual statements are in the quote currency, so per-share figures can be set against the price.

        ADRs report in another currency (TSM: TWD vs USD), and Yahoo sometimes serves statements in USD while
        labelling them in the local currency (PETR4.SA, VALE3.SA). Catch the latter by comparing the scale of
        the latest annual revenue with Yahoo's TTM revenue, which is in the stated currency.
        """
        if self.profile.get("financial_currency") not in (None, self.profile.get("currency")):
            return False
        annual, ttm = _last(_line(self.income, "Total Revenue", "Operating Revenue")), self.ttm("revenue_ttm")
        if annual and ttm and annual > 0 and ttm > 0:
            return 0.4 <= ttm / annual <= 2.5
        return True


# --- Helpers ------------------------------------------------------------------


def _line(statement: pd.DataFrame, *names: str) -> pd.Series:
    """First available line item as a numeric series without missing periods."""
    for name in names:
        if name in statement.columns:
            series = pd.to_numeric(statement[name], errors="coerce").dropna()
            if not series.empty:
                return series
    return pd.Series(dtype=float)


def _last(series: pd.Series) -> float | None:
    return float(series.iloc[-1]) if len(series) else None


def _sum_last_four(statement: pd.DataFrame, *names: str) -> float | None:
    """Trailing-twelve-month total from the last four reported quarters."""
    series = _line(statement, *names)
    return float(series.iloc[-4:].sum()) if len(series) >= 4 else None


def _cagr(series: pd.Series, years: int = TREND_YEARS) -> float | None:
    """Compound annual growth over up to `years` annual periods; None if either end is not positive."""
    if len(series) < 2:
        return None
    n = min(years, len(series) - 1)
    first, last = float(series.iloc[-1 - n]), float(series.iloc[-1])
    if first <= 0 or last <= 0:
        return None
    return (last / first) ** (1 / n) - 1


def _pct(value: float | None, digits: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{digits}%}"


def _x(value: float | None, digits: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}×"


def _missing(what: str) -> Score:
    return Score(None, f"Yahoo Finance has no data to assess {what}.")


# --- Growth -------------------------------------------------------------------


def score_revenue_growth(f: Facts) -> Score:
    revenue = _line(f.income, "Total Revenue", "Operating Revenue")
    recent = f.ttm("revenue_growth")
    if recent is None and len(revenue) >= 2 and revenue.iloc[-2] > 0:
        recent = float(revenue.iloc[-1] / revenue.iloc[-2] - 1)
    cagr = _cagr(revenue)
    if recent is None and cagr is None:
        return _missing("revenue growth")
    path = [f"Latest YoY {_pct(recent)}", f"{TREND_YEARS}Y CAGR {_pct(cagr)}"]
    recent = recent if recent is not None else cagr
    sustained = cagr is not None and cagr >= 0.10

    if recent >= 0.20:
        if sustained:
            return Score(9.5, "Fast growth sustained over several years.", [*path, "≥ 20%", "Sustained"])
        return Score(8, "Growth has accelerated above 20%.", [*path, "≥ 20%", "Accelerating"])
    if recent >= 0.10:
        if sustained:
            return Score(8, "Double-digit growth, consistent with its track record.", [*path, "10-20%", "Sustained"])
        return Score(7, "Double-digit growth, faster than its recent history.", [*path, "10-20%", "Accelerating"])
    if recent >= 0.03:
        if sustained:
            return Score(5.5, "Moderate growth, slowing from a faster pace.", [*path, "3-10%", "Decelerating"])
        return Score(6, "Moderate, steady growth.", [*path, "3-10%"])
    if recent >= 0:
        return Score(4.5, "Revenue is roughly flat.", [*path, "0-3%"])
    if cagr is not None and cagr > 0.05:
        return Score(4, "Revenue dipped after years of growth.", [*path, "Declining", "Growth history"])
    return Score(2, "Revenue is shrinking.", [*path, "Declining"])


def score_earnings_growth(f: Facts) -> Score:
    eps = _line(f.income, "Diluted EPS", "Basic EPS")
    trailing, forward = f.ttm("trailing_eps"), f.ttm("forward_eps")
    trailing = trailing if trailing is not None else _last(eps)
    if trailing is None:
        return _missing("earnings")
    expected = forward / trailing - 1 if forward is not None and trailing > 0 else None
    cagr = _cagr(eps)
    path = [f"EPS (TTM) {trailing:.2f}", f"{TREND_YEARS}Y EPS CAGR {_pct(cagr)}", f"Expected change {_pct(expected)}"]

    if trailing <= 0:
        if forward is not None and forward > 0:
            return Score(4, "Loss-making today, but analysts expect a profit.", [*path, "Losses", "Profit expected"])
        return Score(1.5, "The company is losing money.", [*path, "Losses"])
    growing = expected is None or expected >= 0
    if cagr is None:
        if expected is None:
            return Score(5, "Profitable, but there is too little history to judge the trend.", path)
        return Score(6.5, "Profitable and analysts expect higher EPS.", path) if expected >= 0.05 else Score(4.5, "Profitable, but analysts expect flat or lower EPS.", path)
    if cagr >= 0.15:
        if growing:
            return Score(9, "Strong EPS growth that analysts expect to continue.", [*path, "≥ 15%", "Still growing"])
        return Score(6.5, "Strong EPS growth, but analysts expect a decline.", [*path, "≥ 15%", "Decline expected"])
    if cagr >= 0.05:
        if expected is not None and expected >= 0.05:
            return Score(7.5, "Solid EPS growth with more expected.", [*path, "5-15%", "Still growing"])
        return Score(6, "Solid EPS growth, flattening ahead.", [*path, "5-15%"])
    if cagr >= 0:
        return Score(5, "EPS is roughly flat.", [*path, "0-5%"]) if growing else Score(4, "Flat EPS and analysts expect a decline.", [*path, "0-5%", "Decline expected"])
    if expected is not None and expected > 0.10:
        return Score(4.5, "EPS has fallen, but analysts expect a recovery.", [*path, "Declining", "Recovery expected"])
    return Score(2.5, "EPS is declining.", [*path, "Declining"])


# --- Quality ------------------------------------------------------------------


def score_roe(f: Facts) -> Score:
    equity = _line(f.balance, "Stockholders Equity", "Common Stock Equity")
    net_income = _line(f.income, "Net Income Common Stockholders", "Net Income")
    roe, roa = f.ttm("return_on_equity"), f.ttm("return_on_assets")
    latest_equity = _last(equity)
    if roe is None and latest_equity and latest_equity > 0 and f.ttm("net_income_ttm") is not None:
        roe = f.ttm("net_income_ttm") / latest_equity

    # Annual ROE trend: net income over year-end equity.
    yearly = (net_income / equity.where(equity > 0)).dropna()
    trend = None
    if len(yearly) >= 2:
        n = min(TREND_YEARS, len(yearly) - 1)
        trend = float(yearly.iloc[-1] - yearly.iloc[-1 - n])

    if latest_equity is not None and latest_equity <= 0:
        path = ["Negative equity", f"ROA {_pct(roa)}"]
        if roa is not None and roa >= 0.10:
            return Score(6.5, "Negative equity (usually buybacks or past losses), but returns on assets are strong.", path)
        return Score(2.5, "Negative equity and weak returns on assets.", path)
    if roe is None:
        return _missing("return on equity")

    # Banks run on thin assets: ~1% ROA is healthy for them, ~7% for everyone else.
    quality_roa = 0.01 if f.is_financial else 0.07
    path = [f"ROE {_pct(roe)}", f"ROA {_pct(roa)}"]
    if trend is not None:
        path.append(f"ROE {'up' if trend >= 0 else 'down'} {abs(trend) * 100:.1f} pp over {min(TREND_YEARS, len(yearly) - 1)}Y")
    improving = trend is None or trend >= -0.02

    if roe < 0:
        return Score(1.5, "Negative return on equity: the company is losing money.", [*path, "< 0%"])
    if roe >= 0.20:
        if roa is not None and roa < quality_roa:
            return Score(6.5, "High ROE, but it leans on leverage (low ROA).", [*path, "≥ 20%", "Leveraged"])
        return Score(9, "High returns on equity backed by strong returns on assets.", [*path, "≥ 20%"]) if improving else Score(7.5, "High but falling returns on equity.", [*path, "≥ 20%", "Falling"])
    if roe >= 0.12:
        return Score(7, "Good returns on equity.", [*path, "12-20%"]) if improving else Score(6, "Good but falling returns on equity.", [*path, "12-20%", "Falling"])
    if roe >= 0.06:
        return Score(4.5, "Mediocre returns on equity.", [*path, "6-12%"])
    return Score(3, "Low returns on equity.", [*path, "0-6%"])


def score_margins(f: Facts) -> Score:
    revenue = _line(f.income, "Total Revenue", "Operating Revenue")
    operating = _line(f.income, "Operating Income")
    if not operating.empty:
        name, current, history = "Operating", f.ttm("operating_margin"), operating / revenue
    else:  # Banks report no operating income; fall back to net margin.
        name, current, history = "Net", f.ttm("profit_margin"), _line(f.income, "Net Income") / revenue
    history = history.dropna()
    current = current if current is not None else _last(history)
    if current is None:
        return _missing("margins")
    baseline = float(history.iloc[-TREND_YEARS:].mean()) if len(history) else None
    change = current - baseline if baseline is not None else None
    trend = "stable" if change is None or abs(change) <= 0.01 else "expanding" if change > 0 else "contracting"
    path = [f"{name} margin {_pct(current)}", f"{TREND_YEARS}Y average {_pct(baseline)}", trend.capitalize()]
    gross = f.ttm("gross_margin")
    if gross:
        path.insert(1, f"Gross margin {_pct(gross)}")

    if current < 0:
        if trend == "expanding":
            return Score(3.5, "Unprofitable, but margins are improving.", path)
        return Score(1.5, "Unprofitable and not improving.", path)
    table = {  # level -> (expanding, stable, contracting)
        0.20: (9.5, 8.5, 7, "High margins"),
        0.10: (8, 7, 5.5, "Healthy margins"),
        0.05: (6.5, 5, 4, "Thin margins"),
        0.00: (5, 4, 2.5, "Very thin margins"),
    }
    for floor, (up, flat, down, label) in table.items():
        if current >= floor:
            score = {"expanding": up, "stable": flat, "contracting": down}[trend]
            return Score(score, f"{label}, {trend}.", path)
    raise AssertionError("unreachable")


def score_cash_flow(f: Facts) -> Score:
    if f.is_financial:
        return Score(None, "Free cash flow is not meaningful for banks and insurers (deposits and loans flow through operations).")
    # Sum the last four quarters (Yahoo's own TTM "freeCashflow" is levered FCF and often far off);
    # fall back to the latest fiscal year. Each figure pairs with others from the same statements,
    # so the ratios hold even when Yahoo reports quarters and years in different currencies.
    annual = _line(f.cashflow, "Free Cash Flow")
    q, qi = f.quarterly_cashflow, f.quarterly_income
    fcf = _sum_last_four(q, "Free Cash Flow")
    if fcf is not None:
        source = "Last 4 quarters"
        ocf = _sum_last_four(q, "Operating Cash Flow")
        net_income = _sum_last_four(q, "Net Income From Continuing Operations") or _sum_last_four(qi, "Net Income")
        revenue = _sum_last_four(qi, "Total Revenue", "Operating Revenue")
    else:
        source = "Latest fiscal year"
        fcf, ocf = _last(annual), _last(_line(f.cashflow, "Operating Cash Flow"))
        net_income = _last(_line(f.cashflow, "Net Income From Continuing Operations")) or _last(_line(f.income, "Net Income"))
        revenue = _last(_line(f.income, "Total Revenue", "Operating Revenue"))
    if fcf is None:
        return _missing("cash flow")
    margin = fcf / revenue if revenue else None
    recent = annual.iloc[-4:]
    negative_years = int((recent <= 0).sum())
    path = [source, f"FCF margin {_pct(margin)}", f"FCF negative in {negative_years} of {len(recent)} fiscal years"]

    if fcf <= 0:
        if ocf is not None and ocf > 0:
            return Score(3.5, "Operations generate cash, but capital spending consumes all of it.", [*path, "FCF < 0", "Operating cash flow > 0"])
        return Score(1.5, "The business is burning cash.", [*path, "FCF < 0", "Operating cash flow < 0"])
    if negative_years > 1:
        return Score(5, "Positive free cash flow now, but it has been unreliable.", [*path, "FCF > 0", "Inconsistent"])
    if net_income is None or net_income <= 0:
        return Score(6.5, "Generates free cash flow despite accounting losses.", [*path, "FCF > 0", "Net income ≤ 0"])
    conversion = fcf / net_income
    path.insert(1, f"FCF / net income {_x(conversion, 2)}")
    if conversion >= 0.9:
        if margin is not None and margin >= 0.15:
            return Score(9.5, "Earnings fully backed by cash, with a high FCF margin.", [*path, "Conversion ≥ 90%", "FCF margin ≥ 15%"])
        return Score(8.5, "Earnings fully backed by free cash flow.", [*path, "Conversion ≥ 90%"])
    if conversion >= 0.6:
        return Score(7, "Most earnings turn into free cash flow.", [*path, "Conversion 60-90%"])
    return Score(4.5, "Earnings are only partly backed by cash (heavy capex or working capital).", [*path, "Conversion < 60%"])


def score_balance_sheet(f: Facts) -> Score:
    if f.is_financial:
        return Score(None, "Debt ratios are not meaningful for banks and insurers, whose liabilities are their raw material.")
    debt, cash, ebitda = f.ttm("total_debt"), f.ttm("total_cash"), f.ttm("ebitda_ttm")
    if debt is None:
        debt = _last(_line(f.balance, "Total Debt"))
    if cash is None:
        cash = _last(_line(f.balance, "Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents"))
    if debt is None:
        return _missing("leverage")
    net_debt = debt - (cash or 0)
    current_ratio = f.ttm("current_ratio")
    tight = current_ratio is not None and current_ratio < 1
    path = [f"Current ratio {_x(current_ratio, 2)}"]

    if net_debt <= 0:
        return Score(8 if tight else 9, "Net cash: more cash than debt.", ["Net cash", *path, *(["Current ratio < 1"] if tight else [])])
    if ebitda is None or ebitda <= 0:
        return Score(1.5, "Net debt with no positive EBITDA to service it.", ["Net debt", "EBITDA ≤ 0", *path])
    leverage = net_debt / ebitda
    path.insert(0, f"Net debt / EBITDA {_x(leverage)}")
    for ceiling, score, label in ((1, 8, "Low leverage."), (2, 7, "Comfortable leverage."), (3, 5, "Moderate leverage."), (4, 3.5, "High leverage.")):
        if leverage < ceiling:
            if tight:
                return Score(score - 1, f"{label[:-1]}, but short-term liabilities exceed current assets.", [*path, f"< {ceiling}×", "Current ratio < 1"])
            return Score(score, label, [*path, f"< {ceiling}×"])
    return Score(1.5, "Very high leverage.", [*path, "≥ 4×"])


# --- Valuation ----------------------------------------------------------------


def score_valuation(f: Facts) -> Score:
    trailing, forward = f.ttm("trailing_pe"), f.ttm("forward_pe")
    trailing = trailing if trailing is not None and trailing > 0 else None
    forward = forward if forward is not None and forward > 0 else None
    peg, ev_ebitda, ev_sales = f.ttm("peg_ratio"), f.ttm("ev_to_ebitda"), f.ttm("ev_to_revenue")
    # Latest fiscal year FCF: annual statements are reliably in the financial currency.
    fcf, cap = _last(_line(f.cashflow, "Free Cash Flow")), f.ttm("market_cap")
    fcf_yield = fcf / cap if fcf is not None and cap and f.statements_match_price and not f.is_financial else None
    path = [f"P/E {_x(trailing)}", f"Forward P/E {_x(forward)}", f"PEG {_x(peg, 2)}", f"EV/EBITDA {_x(ev_ebitda)}", f"FCF yield (FY) {_pct(fcf_yield)}"]

    pe = trailing or forward
    pe_name = "P/E" if trailing else "Forward P/E"
    if pe is None:
        if ev_sales is None:
            return _missing("valuation")
        path = ["No earnings", f"EV/Sales {_x(ev_sales)}"]
        if ev_sales < 1:
            return Score(5.5, "No earnings, but priced low relative to sales.", [*path, "< 1×"])
        if ev_sales < 3:
            return Score(4.5, "No earnings; moderate sales multiple.", [*path, "1-3×"])
        if ev_sales < 8:
            return Score(3, "No earnings and a high sales multiple.", [*path, "3-8×"])
        return Score(1.5, "No earnings and a very high sales multiple: priced for perfection.", [*path, "≥ 8×"])

    # Forward P/E well above trailing means analysts expect earnings to fall.
    earnings_falling = trailing is not None and forward is not None and forward > trailing * 1.05
    growth_cheap = peg is not None and 0 < peg <= 1.2
    growth_ok = peg is not None and 0 < peg <= 1.8
    if pe < 10:
        if earnings_falling:
            return Score(5, "Low P/E, but earnings are expected to fall: possible value trap.", [*path, f"{pe_name} < 10", "Earnings falling"])
        return Score(9, "Cheap: low multiple of earnings.", [*path, f"{pe_name} < 10"])
    if pe < 15:
        if earnings_falling:
            return Score(5.5, "Reasonable P/E, but earnings are expected to fall.", [*path, f"{pe_name} 10-15", "Earnings falling"])
        return Score(7.5, "Reasonably priced.", [*path, f"{pe_name} 10-15"])
    if pe < 25:
        if growth_cheap:
            return Score(7, "Fair multiple and cheap for its growth.", [*path, f"{pe_name} 15-25", "PEG ≤ 1.2"])
        if peg is None or growth_ok:
            return Score(5.5, "Fairly valued.", [*path, f"{pe_name} 15-25"])
        return Score(4.5, "Fair multiple, but full price for its growth.", [*path, f"{pe_name} 15-25", "PEG > 1.8"])
    if pe < 40:
        if growth_ok:
            return Score(5, "Premium multiple, supported by growth.", [*path, f"{pe_name} 25-40", "PEG ≤ 1.8"])
        return Score(3, "Expensive.", [*path, f"{pe_name} 25-40"])
    if growth_ok:
        return Score(3.5, "Very high multiple; growth only partly justifies it.", [*path, f"{pe_name} ≥ 40", "PEG ≤ 1.8"])
    return Score(1.5, "Very expensive.", [*path, f"{pe_name} ≥ 40"])


def score_valuation_history(f: Facts) -> Score:
    """Current P/E against the P/E at each past fiscal year end: is the stock cheap or stretched for itself?"""
    if not f.statements_match_price:
        return Score(None, "Yahoo's financial statements are in a different currency from the price, so historical P/E can't be computed.")
    current = f.ttm("trailing_pe")
    eps = _line(f.income, "Diluted EPS", "Basic EPS")
    eps = eps[eps > 0]
    if current is None or current <= 0:
        return Score(None, "No positive trailing earnings to compare with history.")
    if len(eps) < MIN_HISTORY_POINTS:
        return Score(None, f"Needs at least {MIN_HISTORY_POINTS} profitable fiscal years to compare with history.")
    try:
        # Split-adjusted, not dividend-adjusted, to match the reported (split-restated) EPS.
        closes = get_split_adjusted_history(f.ticker, (eps.index[0] - pd.Timedelta(days=10)).date())["close"]
    except MarketDataError:
        return _missing("historical valuation")
    past = []
    for when, value in eps.items():
        prices = closes[closes.index <= when]
        if len(prices):
            past.append(float(prices.iloc[-1]) / float(value))
    if len(past) < MIN_HISTORY_POINTS:
        return Score(None, "Not enough price history around past fiscal year ends.")
    median = float(pd.Series(past).median())
    ratio = current / median
    path = [f"P/E now {_x(current)}", f"Median at {len(past)} FY ends {_x(median)}", f"{ratio:.2f}× its usual multiple"]

    if ratio < 0.7:
        return Score(8.5, "Trading well below its usual multiple.", [*path, "< 0.7×"])
    if ratio < 0.9:
        return Score(7, "Somewhat cheaper than usual.", [*path, "0.7-0.9×"])
    if ratio < 1.1:
        return Score(5.5, "In line with its usual multiple.", [*path, "0.9-1.1×"])
    if ratio < 1.3:
        return Score(4, "Richer than usual: the price has run ahead of earnings.", [*path, "1.1-1.3×"])
    return Score(2.5, "Stretched: the multiple is far above its history (overbought on fundamentals).", [*path, "≥ 1.3×"])


@dataclass(frozen=True)
class Factor:
    id: str
    label: str
    group: str
    scorer: Callable[[Facts], Score]


FACTORS = [
    Factor("revenue_growth", "Revenue growth", "growth", score_revenue_growth),
    Factor("earnings_growth", "Earnings growth", "growth", score_earnings_growth),
    Factor("roe", "Return on equity", "quality", score_roe),
    Factor("margins", "Margins", "quality", score_margins),
    Factor("cash_flow", "Free cash flow", "quality", score_cash_flow),
    Factor("balance_sheet", "Balance sheet", "quality", score_balance_sheet),
    Factor("valuation", "Valuation multiples", "valuation", score_valuation),
    Factor("valuation_history", "P/E vs own history", "valuation", score_valuation_history),
]


def _statement(ticker: str, kind: str, frequency: str = "annual") -> pd.DataFrame:
    try:
        return get_statement(ticker, kind, frequency).dropna(how="all")
    except MarketDataError:
        return pd.DataFrame()


def score_fundamentals(ticker: str, weights: dict[str, float] | None = None) -> dict[str, Any]:
    ticker = ticker.upper()
    weights = weights or {}
    facts = Facts(
        profile=get_profile(ticker),
        income=_statement(ticker, "income"),
        balance=_statement(ticker, "balance"),
        cashflow=_statement(ticker, "cashflow"),
        quarterly_income=_statement(ticker, "income", "quarterly"),
        quarterly_cashflow=_statement(ticker, "cashflow", "quarterly"),
        ticker=ticker,
    )
    if facts.income.empty and facts.profile.get("revenue_ttm") is None:
        raise MarketDataError(f"No financial statements found for {ticker}")

    items = []
    for factor in FACTORS:
        result = factor.scorer(facts)
        items.append(
            {
                "key": factor.id,
                "id": factor.id,
                "group": factor.group,
                "label": factor.label,
                "score": result.score,
                "signal": signal_for(result.score),
                "summary": result.summary,
                "path": result.path,
                "weight": float(weights.get(factor.id, 1.0)),
            }
        )

    fiscal = facts.income.index[-1].date().isoformat() if not facts.income.empty else None
    return {
        "ticker": ticker,
        "as_of": date.today().isoformat(),
        "fiscal_year_end": fiscal,
        "summary": weighted_summary(items),
        "groups": [
            {"id": gid, "label": label, **weighted_summary([i for i in items if i["group"] == gid])} for gid, label in GROUPS.items()
        ],
        "indicators": items,
    }
