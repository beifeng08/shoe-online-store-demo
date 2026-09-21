"""Bounded sweeps, one transaction per order; safe alongside cancellation/other workers."""

import asyncio
import json
import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.application.commerce import expire_if_due, lock_cart, owned_order
from app.config import settings
from app.domain.models import Order
from app.infrastructure.database import SessionLocal

logger = logging.getLogger("commerce.expiry")


def expire_due_orders(
    sessions: sessionmaker[Session] = SessionLocal,
    *,
    now: datetime | None = None,
    batch_size: int | None = None,
) -> int:
    cutoff = now or datetime.now(UTC)
    # Close this read transaction before acquiring any write locks (SQLite WAL).
    with sessions() as db:
        candidates = db.execute(
            select(Order.id, Order.cart_id)
            .where(
                Order.status == "pending_payment",
                Order.expires_at <= cutoff,
            )
            .order_by(Order.expires_at, Order.id)
            .limit(batch_size or settings.reservation_sweep_batch_size)
        ).all()
    expired = 0
    for order_id, cart_id in candidates:
        with sessions() as db, db.begin():
            lock_cart(db, cart_id)
            # Re-read AFTER locking: another worker/cancel may already have released it.
            if expire_if_due(db, owned_order(db, cart_id, order_id), now=cutoff):
                expired += 1
    if expired:
        logger.info(json.dumps(dict(event="reservations_expired", orders=expired)))
    return expired


async def expiry_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await asyncio.to_thread(expire_due_orders)
        except Exception:
            # A transient DB outage must not silently kill cleanup until restart.
            logger.exception(json.dumps(dict(event="reservation_sweep_failed")))
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.reservation_sweep_seconds)
        except TimeoutError:
            pass
