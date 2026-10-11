from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Holding, Portfolio
from app.schemas import (
    WEIGHT_TOLERANCE,
    HoldingIn,
    HoldingOut,
    HoldingsReplace,
    HoldingUpdate,
    PortfolioCreate,
    PortfolioOut,
    PortfolioUpdate,
)
from app.services import portfolio_analytics

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


def _out(portfolio: Portfolio) -> PortfolioOut:
    return PortfolioOut.model_validate(
        {
            **{c: getattr(portfolio, c) for c in ("id", "name", "description", "created_at", "updated_at")},
            "holdings": portfolio.holdings,
            "total_weight": sum(h.weight for h in portfolio.holdings),
        }
    )


def _get(db: Session, portfolio_id: int) -> Portfolio:
    portfolio = db.scalar(
        select(Portfolio).where(Portfolio.id == portfolio_id).options(selectinload(Portfolio.holdings))
    )
    if portfolio is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Portfolio not found")
    return portfolio


def _check_total(portfolio: Portfolio) -> None:
    if sum(h.weight for h in portfolio.holdings) > 1 + WEIGHT_TOLERANCE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Weights must add up to at most 100%")


def _weights(portfolio: Portfolio) -> dict[str, float]:
    if not portfolio.holdings:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The portfolio has no holdings yet")
    return {h.ticker: h.weight for h in portfolio.holdings}


# --- Portfolio CRUD -------------------------------------------------------------


@router.get("", response_model=list[PortfolioOut])
def list_portfolios(db: Session = Depends(get_db)):
    portfolios = db.scalars(select(Portfolio).options(selectinload(Portfolio.holdings)).order_by(Portfolio.id))
    return [_out(p) for p in portfolios]


@router.post("", response_model=PortfolioOut, status_code=status.HTTP_201_CREATED)
def create_portfolio(payload: PortfolioCreate, db: Session = Depends(get_db)):
    portfolio = Portfolio(
        name=payload.name,
        description=payload.description,
        holdings=[Holding(ticker=h.ticker, weight=h.weight) for h in payload.holdings],
    )
    db.add(portfolio)
    db.commit()
    return _out(_get(db, portfolio.id))


@router.get("/{portfolio_id}", response_model=PortfolioOut)
def get_portfolio(portfolio_id: int, db: Session = Depends(get_db)):
    return _out(_get(db, portfolio_id))


@router.patch("/{portfolio_id}", response_model=PortfolioOut)
def update_portfolio(portfolio_id: int, payload: PortfolioUpdate, db: Session = Depends(get_db)):
    portfolio = _get(db, portfolio_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(portfolio, field, value)
    db.commit()
    return _out(_get(db, portfolio_id))


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio(portfolio_id: int, db: Session = Depends(get_db)):
    db.delete(_get(db, portfolio_id))
    db.commit()


# --- Holdings -------------------------------------------------------------------


@router.put("/{portfolio_id}/holdings", response_model=PortfolioOut)
def replace_holdings(portfolio_id: int, payload: HoldingsReplace, db: Session = Depends(get_db)):
    """Replace every holding at once (what the editable table in the UI uses)."""
    portfolio = _get(db, portfolio_id)
    portfolio.holdings.clear()
    db.flush()
    portfolio.holdings.extend(Holding(ticker=h.ticker, weight=h.weight) for h in payload.holdings)
    db.commit()
    return _out(_get(db, portfolio_id))


@router.post("/{portfolio_id}/holdings", response_model=HoldingOut, status_code=status.HTTP_201_CREATED)
def add_holding(portfolio_id: int, payload: HoldingIn, db: Session = Depends(get_db)):
    portfolio = _get(db, portfolio_id)
    holding = Holding(ticker=payload.ticker, weight=payload.weight)
    portfolio.holdings.append(holding)
    _check_total(portfolio)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"{payload.ticker} is already in this portfolio")
    return holding


@router.patch("/{portfolio_id}/holdings/{holding_id}", response_model=HoldingOut)
def update_holding(portfolio_id: int, holding_id: int, payload: HoldingUpdate, db: Session = Depends(get_db)):
    portfolio = _get(db, portfolio_id)
    holding = next((h for h in portfolio.holdings if h.id == holding_id), None)
    if holding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Holding not found")
    holding.weight = payload.weight
    _check_total(portfolio)
    db.commit()
    return holding


@router.delete("/{portfolio_id}/holdings/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holding(portfolio_id: int, holding_id: int, db: Session = Depends(get_db)):
    portfolio = _get(db, portfolio_id)
    holding = next((h for h in portfolio.holdings if h.id == holding_id), None)
    if holding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Holding not found")
    portfolio.holdings.remove(holding)
    db.commit()


# --- Analysis -------------------------------------------------------------------


@router.get("/{portfolio_id}/analytics")
def portfolio_analytics_view(
    portfolio_id: int,
    period: str = "1y",
    risk_free_rate: float | None = Query(None, description="Annual rate as a fraction; defaults to ^IRX"),
    benchmark: str | None = "SPY",
    db: Session = Depends(get_db),
):
    return portfolio_analytics.analyze(_weights(_get(db, portfolio_id)), period, risk_free_rate, benchmark or None)


@router.get("/{portfolio_id}/composition")
def portfolio_composition(portfolio_id: int, db: Session = Depends(get_db)):
    return portfolio_analytics.composition(_weights(_get(db, portfolio_id)))
