from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, Float, ForeignKey, String, UniqueConstraint, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.db import Base

DEFAULT_BENCHMARK = "SPY"


class Portfolio(Base):
    __tablename__ = "portfolios"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    # Ticker the portfolio is compared against in analytics (e.g. SPY, QQQ, ^BVSP).
    benchmark: Mapped[str] = mapped_column(String(20), default=DEFAULT_BENCHMARK, server_default=DEFAULT_BENCHMARK)
    # Date of the prices the weights were last derived from, for portfolios whose holdings
    # are share positions built from imported transactions (None for fixed target weights).
    weights_as_of: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    holdings: Mapped[list["Holding"]] = relationship(
        back_populates="portfolio",
        cascade="all, delete-orphan",
        order_by="Holding.weight.desc()",
    )
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="portfolio",
        cascade="all, delete-orphan",
        order_by="(Transaction.date, Transaction.id)",
    )


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("portfolio_id", "ticker", name="uq_holding_portfolio_ticker"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    ticker: Mapped[str] = mapped_column(String(20))
    # Fraction of the portfolio, 0 < weight <= 1 (the UI shows it as a percentage).
    weight: Mapped[float] = mapped_column(Float)
    # Shares held (in today's split basis) when the holding comes from imported transactions;
    # the weight is then re-derived from market prices whenever the portfolio is loaded.
    quantity: Mapped[float | None] = mapped_column(Float)

    portfolio: Mapped[Portfolio] = relationship(back_populates="holdings")


class Transaction(Base):
    """One trade of an imported statement (B3's "Negociação" export)."""

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)
    # Yahoo Finance symbol, e.g. MGLU3.SA
    ticker: Mapped[str] = mapped_column(String(20))
    # "buy" | "sell"
    kind: Mapped[str] = mapped_column(String(10))
    quantity: Mapped[float] = mapped_column(Float)
    # Unit price and total as reported.
    price: Mapped[float | None] = mapped_column(Float)
    amount: Mapped[float | None] = mapped_column(Float)
    movement: Mapped[str] = mapped_column(String(80))
    institution: Mapped[str | None] = mapped_column(String(120))

    portfolio: Mapped[Portfolio] = relationship(back_populates="transactions")


Portfolio.transaction_count = column_property(
    select(func.count(Transaction.id)).where(Transaction.portfolio_id == Portfolio.id).correlate_except(Transaction).scalar_subquery()
)


class BacktestRun(Base):
    """A saved backtest: what was run (target, strategy, params, costs) and its headline stats.

    Curves and trades are not stored; re-running the saved config reproduces them.
    """

    __tablename__ = "backtest_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # "stock" | "portfolio"
    target_type: Mapped[str] = mapped_column(String(20))
    ticker: Mapped[str | None] = mapped_column(String(20), index=True)
    portfolio_id: Mapped[int | None] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    strategy_id: Mapped[str] = mapped_column(String(40))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # period, benchmark, commission_bps, slippage_bps, risk_free_rate
    config: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # stats (strategy / buy_hold / benchmark), start, end
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB)
