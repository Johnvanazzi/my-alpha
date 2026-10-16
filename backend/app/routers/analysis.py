from typing import Annotated

from fastapi import APIRouter, Query

from app.services import compare as compare_service
from app.services import fundamentals
from app.services.fundamental_scoring import score_fundamentals
from app.services.market_data import validate_period
from app.services.scoring import parse_weights

router = APIRouter(tags=["analysis"])


@router.get("/fundamentals/{ticker}")
def get_fundamentals(ticker: str, frequency: str = "annual"):
    return fundamentals.get_fundamentals(ticker, frequency)


@router.get("/fundamentals/{ticker}/score")
def fundamental_score(
    ticker: str,
    weights: Annotated[list[str], Query(description='Weights per factor id, e.g. "valuation=2" or "roe=0.5". Default 1.')] = [],
):
    """0-10 scores for growth, quality (ROE, margins, cash flow, leverage) and valuation, with a weighted summary."""
    return score_fundamentals(ticker, parse_weights(weights))


@router.get("/compare")
def compare(
    tickers: Annotated[list[str], Query(description="2-4 tickers, e.g. ?tickers=AAPL&tickers=MSFT")],
    period: str = "1y",
    benchmark: str | None = "SPY",
    risk_free_rate: float | None = Query(None, description="Annual rate as a fraction; defaults to ^IRX"),
    window: int = Query(63, description="Rolling correlation window in trading days"),
):
    """Risk/return, benchmark relationship, correlation and fundamentals for several stocks."""
    validate_period(period)
    return compare_service.compare(tickers, period, benchmark, risk_free_rate, window)
