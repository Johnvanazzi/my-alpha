"""Saved backtest runs.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-14
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "backtest_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("ticker", sa.String(20), nullable=True),
        sa.Column("portfolio_id", sa.Integer(), sa.ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=True),
        sa.Column("strategy_id", sa.String(40), nullable=False),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.Column("summary", postgresql.JSONB(), nullable=False),
    )
    op.create_index("ix_backtest_runs_ticker", "backtest_runs", ["ticker"])
    op.create_index("ix_backtest_runs_portfolio_id", "backtest_runs", ["portfolio_id"])


def downgrade() -> None:
    op.drop_index("ix_backtest_runs_portfolio_id", "backtest_runs")
    op.drop_index("ix_backtest_runs_ticker", "backtest_runs")
    op.drop_table("backtest_runs")
