"""Add reservation deadlines without rebuilding or deleting historical orders."""

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from alembic import op

revision = "a682dde201b4"
down_revision = "41e28c896353"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("cancellation_reason", sa.String(30), nullable=True))
    orders = sa.table(
        "orders",
        sa.column("status", sa.String(30)),
        sa.column("expires_at", sa.DateTime(timezone=True)),
    )
    # Existing pending orders get a fresh, documented 30-minute grace period.
    # Terminal historical orders keep a null deadline; never revive reservations.
    op.execute(
        orders.update()
        .where(orders.c.status == "pending_payment")
        .values(expires_at=datetime.now(UTC) + timedelta(minutes=30))
    )
    op.create_index("ix_orders_status_expires_at", "orders", ["status", "expires_at"])


def downgrade() -> None:
    # Already released inventory and cancelled orders remain terminal on downgrade.
    op.drop_index("ix_orders_status_expires_at", table_name="orders")
    op.drop_column("orders", "cancellation_reason")
    op.drop_column("orders", "expires_at")
