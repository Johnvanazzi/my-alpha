from fastapi import APIRouter

from app.schemas import SharpeRequest
from app.services import fundamentals, portfolio_analytics

router = APIRouter(tags=["analysis"])


@router.post("/analytics/sharpe")
def sharpe_calculator(payload: SharpeRequest):
    """Sharpe ratio (and related stats) for an ad-hoc set of tickers and weights."""
    weights: dict[str, float] = {}
    for h in payload.holdings:
        weights[h.ticker] = weights.get(h.ticker, 0) + h.weight
    return portfolio_analytics.analyze(weights, payload.period, payload.risk_free_rate, benchmark="SPY")


@router.get("/fundamentals/{ticker}")
def get_fundamentals(ticker: str, frequency: str = "annual"):
    return fundamentals.get_fundamentals(ticker, frequency)
