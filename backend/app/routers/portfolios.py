from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import DEFAULT_BENCHMARK, Holding, Portfolio, Transaction
from app.schemas import (
    WEIGHT_TOLERANCE,
    ImportResult,
    ImportSummary,
    HoldingIn,
    HoldingOut,
    HoldingsReplace,
    HoldingUpdate,
    PortfolioCopy,
    PortfolioCreate,
    PortfolioOut,
    PortfolioUpdate,
    TransactionIn,
    TransactionOut,
    TransactionPage,
)
from app.services import hrp, portfolio_analytics, tearsheet, transactions
from app.services.market_data import MarketDataError, get_split_adjusted_history

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


def _out(portfolio: Portfolio) -> PortfolioOut:
    return PortfolioOut.model_validate(
        {
            **{
                c: getattr(portfolio, c)
                for c in ("id", "name", "description", "benchmark", "created_at", "updated_at", "weights_as_of", "transaction_count")
            },
            "holdings": portfolio.holdings,
            "total_weight": sum(h.weight for h in portfolio.holdings),
        }
    )


def _get(db: Session, portfolio_id: int) -> Portfolio:
    # populate_existing: re-read columns such as transaction_count after a commit in the same session.
    portfolio = db.scalar(
        select(Portfolio)
        .where(Portfolio.id == portfolio_id)
        .options(selectinload(Portfolio.holdings))
        .execution_options(populate_existing=True)
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


# --- Positions from transactions ------------------------------------------------


def _txs(portfolio: Portfolio) -> list[transactions.Tx]:
    return [
        transactions.Tx(
            date=t.date, ticker=t.ticker, kind=t.kind, quantity=t.quantity, price=t.price, amount=t.amount,
            movement=t.movement, institution=t.institution,
        )
        for t in portfolio.transactions
    ]


def _tracks_positions(portfolio: Portfolio) -> bool:
    return any(h.quantity is not None for h in portfolio.holdings)


def _apply_positions(portfolio: Portfolio, sim: transactions.Simulation) -> None:
    """Make the holdings the open positions, weighted by their market value at the latest close.

    Existing rows are updated in place so holding ids stay stable across refreshes.
    """
    positions = {p["ticker"]: p for p in transactions.current_positions(sim)}
    for holding in list(portfolio.holdings):
        if holding.ticker not in positions:
            portfolio.holdings.remove(holding)
    existing = {h.ticker: h for h in portfolio.holdings}
    for ticker, p in positions.items():
        holding = existing.get(ticker)
        if holding is None:
            portfolio.holdings.append(Holding(ticker=ticker, weight=p["weight"], quantity=p["quantity"]))
        else:
            holding.weight, holding.quantity = p["weight"], p["quantity"]
    portfolio.holdings.sort(key=lambda h: -h.weight)
    portfolio.weights_as_of = transactions.prices_as_of(sim)


def _refresh_weights(db: Session, portfolio: Portfolio) -> None:
    """Re-price share positions so the weights reflect the current market (best effort)."""
    if not portfolio.transactions or not _tracks_positions(portfolio):
        return
    try:
        sim = transactions.simulate(_txs(portfolio))
    except (MarketDataError, ValueError):
        return  # keep the last stored weights when Yahoo is unavailable
    _apply_positions(portfolio, sim)
    db.commit()


def _rebuild_positions(portfolio: Portfolio) -> None:
    """After the trades change, make the holdings follow them again.

    Portfolios whose weights were set by hand keep them (sync explicitly to switch);
    portfolios without holdings start following their positions.
    """
    if portfolio.holdings and not _tracks_positions(portfolio):
        return
    if not portfolio.transactions:
        portfolio.holdings.clear()
        portfolio.weights_as_of = None
        return
    _apply_positions(portfolio, transactions.simulate(_txs(portfolio)))


def _import(db: Session, portfolio: Portfolio, file: UploadFile) -> ImportResult:
    parsed = transactions.parse_statement(file.file.read())
    sim = transactions.simulate(parsed.transactions)
    portfolio.transactions.clear()
    portfolio.holdings.clear()
    db.flush()
    portfolio.transactions.extend(
        Transaction(
            date=t.date, ticker=t.ticker, kind=t.kind, quantity=t.quantity, price=t.price, amount=t.amount,
            movement=t.movement, institution=t.institution,
        )
        for t in parsed.transactions
    )
    _apply_positions(portfolio, sim)
    db.commit()
    summary = ImportSummary(
        rows=parsed.rows,
        transactions=len(parsed.transactions),
        start=parsed.transactions[0].date,
        end=parsed.transactions[-1].date,
        tickers=sorted({t.ticker for t in parsed.transactions}),
        skipped=parsed.skipped,
        unpriced=sim.unpriced,
        warnings=sim.warnings,
    )
    return ImportResult(portfolio=_out(_get(db, portfolio.id)), summary=summary)


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
        benchmark=payload.benchmark,
        holdings=[Holding(ticker=h.ticker, weight=h.weight) for h in payload.holdings],
    )
    db.add(portfolio)
    db.commit()
    return _out(_get(db, portfolio.id))


@router.post("/{portfolio_id}/copy", response_model=PortfolioOut, status_code=status.HTTP_201_CREATED)
def copy_portfolio(portfolio_id: int, payload: PortfolioCopy | None = None, db: Session = Depends(get_db)):
    """Duplicate a portfolio with its holdings, description and benchmark."""
    source = _get(db, portfolio_id)
    name = payload.name if payload and payload.name else f"{source.name} (copy)"[:120]
    copy = Portfolio(
        name=name,
        description=source.description,
        benchmark=source.benchmark,
        weights_as_of=source.weights_as_of,
        holdings=[Holding(ticker=h.ticker, weight=h.weight, quantity=h.quantity) for h in source.holdings],
        transactions=[
            Transaction(
                date=t.date, ticker=t.ticker, kind=t.kind, quantity=t.quantity, price=t.price, amount=t.amount,
                movement=t.movement, institution=t.institution,
            )
            for t in source.transactions
        ],
    )
    db.add(copy)
    db.commit()
    return _out(_get(db, copy.id))


@router.post("/import", response_model=ImportResult, status_code=status.HTTP_201_CREATED)
def import_portfolio(
    file: UploadFile = File(..., description="B3 Negociação export (.xlsx)"),
    name: str = Form(..., min_length=1, max_length=120),
    description: str | None = Form(None, max_length=500),
    benchmark: str = Form("^BVSP", max_length=20),
    db: Session = Depends(get_db),
):
    """Create a portfolio from a statement of transactions; holdings become the open positions."""
    portfolio = Portfolio(
        name=name.strip(), description=(description or "").strip() or None, benchmark=benchmark.strip().upper() or DEFAULT_BENCHMARK
    )
    db.add(portfolio)
    db.flush()
    try:
        return _import(db, portfolio, file)
    except Exception:
        db.rollback()
        raise


@router.get("/{portfolio_id}", response_model=PortfolioOut)
def get_portfolio(portfolio_id: int, db: Session = Depends(get_db)):
    portfolio = _get(db, portfolio_id)
    _refresh_weights(db, portfolio)
    return _out(_get(db, portfolio_id))


@router.patch("/{portfolio_id}", response_model=PortfolioOut)
def update_portfolio(portfolio_id: int, payload: PortfolioUpdate, db: Session = Depends(get_db)):
    portfolio = _get(db, portfolio_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is None and field in ("name", "benchmark"):
            continue  # not nullable; only description can be cleared
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
    """Replace every holding at once (what the editable table in the UI uses).

    Manual weights are fixed targets: the portfolio stops following its imported positions
    until they are re-synced.
    """
    portfolio = _get(db, portfolio_id)
    portfolio.weights_as_of = None
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


# --- Transactions ---------------------------------------------------------------


@router.post("/{portfolio_id}/transactions/import", response_model=ImportResult)
def import_transactions(
    portfolio_id: int,
    file: UploadFile = File(..., description="B3 Negociação export (.xlsx)"),
    db: Session = Depends(get_db),
):
    """Replace the portfolio's transactions with a new statement and rebuild its holdings."""
    portfolio = _get(db, portfolio_id)
    try:
        return _import(db, portfolio, file)
    except Exception:
        db.rollback()
        raise


@router.get("/{portfolio_id}/transactions", response_model=TransactionPage)
def list_transactions(
    portfolio_id: int,
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """One page of the portfolio's trades, newest first."""
    _get(db, portfolio_id)
    where = Transaction.portfolio_id == portfolio_id
    items = db.scalars(
        select(Transaction).where(where).order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit).offset(offset)
    ).all()
    total = db.scalar(select(func.count()).select_from(Transaction).where(where)) or 0
    return TransactionPage(items=items, total=total, limit=limit, offset=offset)


@router.post("/{portfolio_id}/transactions", response_model=PortfolioOut, status_code=status.HTTP_201_CREATED)
def add_transaction(portfolio_id: int, payload: TransactionIn, db: Session = Depends(get_db)):
    """Record a trade by hand and rebuild the positions."""
    portfolio = _get(db, portfolio_id)
    ticker = transactions.yahoo_symbol(payload.ticker)
    try:
        # A short look-back so a trade made today, before the first quote, still validates.
        get_split_adjusted_history(ticker, payload.date - timedelta(days=10))
    except MarketDataError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"No market data for {ticker} on Yahoo Finance")

    tx = transactions.Tx(
        date=payload.date,
        ticker=ticker,
        kind=payload.kind,
        quantity=payload.quantity,
        price=payload.price,
        amount=payload.price * payload.quantity if payload.price else None,
        movement="Compra · Manual" if payload.kind == "buy" else "Venda · Manual",
        institution=payload.institution.strip() or None if payload.institution else None,
    )
    if tx.kind == "sell":
        existing = _txs(portfolio)
        before = transactions.simulate(existing).oversold.get(ticker, 0.0) if existing else 0.0
        after = transactions.simulate([*existing, tx]).oversold.get(ticker, 0.0)
        if after > before + transactions.EPSILON:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Selling {payload.quantity:g} {ticker} on {payload.date} is more than the shares held then "
                "(or leaves a later sale without enough shares)",
            )

    portfolio.transactions.append(
        Transaction(
            date=tx.date, ticker=tx.ticker, kind=tx.kind, quantity=tx.quantity, price=tx.price, amount=tx.amount,
            movement=tx.movement, institution=tx.institution,
        )
    )
    try:
        _rebuild_positions(portfolio)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _out(_get(db, portfolio_id))


@router.delete("/{portfolio_id}/transactions/{transaction_id}", response_model=PortfolioOut)
def delete_transaction(portfolio_id: int, transaction_id: int, db: Session = Depends(get_db)):
    """Remove a trade and rebuild the positions."""
    portfolio = _get(db, portfolio_id)
    tx = next((t for t in portfolio.transactions if t.id == transaction_id), None)
    if tx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
    portfolio.transactions.remove(tx)
    try:
        _rebuild_positions(portfolio)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _out(_get(db, portfolio_id))


@router.post("/{portfolio_id}/positions/sync", response_model=PortfolioOut)
def sync_positions(portfolio_id: int, db: Session = Depends(get_db)):
    """Reset the holdings to the open positions from the transactions, at current prices."""
    portfolio = _get(db, portfolio_id)
    if not portfolio.transactions:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The portfolio has no transactions")
    _apply_positions(portfolio, transactions.simulate(_txs(portfolio)))
    db.commit()
    return _out(_get(db, portfolio_id))


@router.get("/{portfolio_id}/evolution")
def portfolio_evolution(portfolio_id: int, db: Session = Depends(get_db)):
    """Daily market value, net invested capital and weights rebuilt from the trades."""
    portfolio = _get(db, portfolio_id)
    if not portfolio.transactions:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The portfolio has no transactions")
    return transactions.evolution(transactions.simulate(_txs(portfolio)))


# --- Analysis -------------------------------------------------------------------


@router.get("/{portfolio_id}/analytics")
def portfolio_analytics_view(
    portfolio_id: int,
    period: str = "1y",
    risk_free_rate: float | None = Query(None, description="Annual rate as a fraction; defaults to ^IRX"),
    benchmark: str | None = Query(None, description="Override the portfolio's saved benchmark for this request"),
    db: Session = Depends(get_db),
):
    portfolio = _get(db, portfolio_id)
    return portfolio_analytics.analyze(_weights(portfolio), period, risk_free_rate, benchmark or portfolio.benchmark)


@router.get("/{portfolio_id}/composition")
def portfolio_composition(portfolio_id: int, db: Session = Depends(get_db)):
    return portfolio_analytics.composition(_weights(_get(db, portfolio_id)))


@router.get("/{portfolio_id}/hrp")
def portfolio_hrp(
    portfolio_id: int,
    period: str = "1y",
    linkage: str = Query("single", description=f"Clustering linkage: {', '.join(hrp.LINKAGE_METHODS)}"),
    risk_free_rate: float | None = Query(None, description="Annual rate as a fraction; defaults to ^IRX"),
    db: Session = Depends(get_db),
):
    """Hierarchical Risk Parity weights, clustered correlation matrix and dendrogram."""
    return hrp.hrp_analysis(_weights(_get(db, portfolio_id)), period, risk_free_rate, linkage)


@router.get("/{portfolio_id}/tearsheet")
def portfolio_tearsheet(
    portfolio_id: int,
    period: str = "2y",
    window: int = Query(tearsheet.DEFAULT_WINDOW, description="Rolling window in trading days"),
    risk_free_rate: float | None = Query(None, description="Annual rate as a fraction; defaults to ^IRX"),
    benchmark: str | None = Query(None, description="Override the portfolio's saved benchmark"),
    db: Session = Depends(get_db),
):
    """pyfolio analysis: rolling volatility/beta/Sharpe, underwater curve, drawdowns, monthly returns."""
    portfolio = _get(db, portfolio_id)
    return tearsheet.tearsheet(_weights(portfolio), period, benchmark or portfolio.benchmark, window, risk_free_rate)
