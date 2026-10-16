"""Per-portfolio benchmark ticker.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("portfolios", sa.Column("benchmark", sa.String(20), nullable=False, server_default="SPY"))


def downgrade() -> None:
    op.drop_column("portfolios", "benchmark")
