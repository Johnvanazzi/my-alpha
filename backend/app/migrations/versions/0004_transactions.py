"""Imported transactions and share-based holdings.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-15
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("holdings", sa.Column("quantity", sa.Float(), nullable=True))
    op.add_column("portfolios", sa.Column("weights_as_of", sa.Date(), nullable=True))
    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("portfolio_id", sa.Integer(), sa.ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("movement", sa.String(80), nullable=False),
        sa.Column("institution", sa.String(120), nullable=True),
    )
    op.create_index("ix_transactions_portfolio_id", "transactions", ["portfolio_id"])


def downgrade() -> None:
    op.drop_index("ix_transactions_portfolio_id", "transactions")
    op.drop_table("transactions")
    op.drop_column("portfolios", "weights_as_of")
    op.drop_column("holdings", "quantity")
