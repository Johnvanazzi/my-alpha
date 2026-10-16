from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import DEFAULT_BENCHMARK, BacktestRun, Portfolio
from app.schemas import BacktestRequest, BacktestRunOut
from app.services import backtest
from app.services.portfolio_analytics import resolve_risk_free

router = APIRouter(prefix="/backtests", tags=["backtests"])


@router.get("/strategies")
def list_strategies():
    """Strategy metadata (kind, parameters with defaults and bounds) for building forms."""
    return backtest.strategies_metadata()


@router.post("")
def run_backtest(payload: BacktestRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Run a strategy on a stock or a saved portfolio and (by default) save its headline stats."""
    target = payload.target
    strategy = backtest.get_strategy(payload.strategy.id, target.type)
    params = backtest.validate_params(strategy, payload.strategy.params)
    rf = resolve_risk_free(payload.risk_free_rate)
    costs = {"commission_bps": payload.commission_bps, "slippage_bps": payload.slippage_bps}

    if target.type == "stock":
        benchmark = DEFAULT_BENCHMARK if payload.benchmark is None else payload.benchmark.strip().upper()
        result = backtest.run_stock(target.ticker, strategy.id, params, payload.period, benchmark or None, rf=rf, **costs)
        target_out: dict[str, Any] = {"type": "stock", "ticker": target.ticker}
    else:
        portfolio = db.scalar(
            select(Portfolio).where(Portfolio.id == target.portfolio_id).options(selectinload(Portfolio.holdings))
        )
        if portfolio is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Portfolio not found")
        if not portfolio.holdings:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The portfolio has no holdings yet")
        benchmark = portfolio.benchmark if payload.benchmark is None else payload.benchmark.strip().upper()
        weights = {h.ticker: h.weight for h in portfolio.holdings}
        result = backtest.run_portfolio(weights, strategy.id, params, payload.period, benchmark or None, rf=rf, **costs)
        target_out = {"type": "portfolio", "portfolio_id": portfolio.id, "name": portfolio.name}

    config = {"period": payload.period, "benchmark": benchmark or None, **costs, "risk_free_rate": payload.risk_free_rate}
    run_id, created_at = None, None
    if payload.save:
        run = BacktestRun(
            target_type=target.type,
            ticker=target.ticker if target.type == "stock" else None,
            portfolio_id=target.portfolio_id if target.type == "portfolio" else None,
            strategy_id=strategy.id,
            params=params,
            config=config,
            summary={"start": result["start"], "end": result["end"], "stats": result["stats"]},
        )
        db.add(run)
        db.commit()
        run_id, created_at = run.id, run.created_at

    return {
        "id": run_id,
        "created_at": created_at,
        "target": target_out,
        "strategy": {"id": strategy.id, "name": strategy.name, "params": params},
        "config": config,
        **result,
    }


@router.get("", response_model=list[BacktestRunOut])
def list_runs(
    ticker: str | None = Query(None, description="Only runs on this stock"),
    portfolio_id: int | None = Query(None, description="Only runs on this portfolio"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = select(BacktestRun).order_by(BacktestRun.created_at.desc(), BacktestRun.id.desc()).limit(limit)
    if ticker:
        query = query.where(BacktestRun.ticker == ticker.strip().upper())
    if portfolio_id is not None:
        query = query.where(BacktestRun.portfolio_id == portfolio_id)
    return db.scalars(query).all()


def _get_run(db: Session, run_id: int) -> BacktestRun:
    run = db.get(BacktestRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Backtest run not found")
    return run


@router.get("/{run_id}", response_model=BacktestRunOut)
def get_run(run_id: int, db: Session = Depends(get_db)):
    return _get_run(db, run_id)


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_run(run_id: int, db: Session = Depends(get_db)):
    db.delete(_get_run(db, run_id))
    db.commit()
