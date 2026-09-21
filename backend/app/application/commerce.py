from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.domain.models import (
    AuditLog,
    Cart,
    CartItem,
    Inventory,
    Order,
    OrderItem,
    Payment,
    PaymentEvent,
    Product,
    Reservation,
    Variant,
)


def audit(db: Session, entity: str, action: str, **details: Any) -> None:
    db.add(AuditLog(entity_id=entity, action=action, details=details))


def lock_cart(db: Session, session_id: str) -> Cart:
    # Upsert + UPDATE is a per-session write lock in PostgreSQL and a write lock in
    # SQLite. Lock BEFORE reads, so concurrent cart edits/checkouts serialize.
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    db.execute(insert(Cart).values(id=session_id, revision=0).on_conflict_do_nothing())
    db.execute(update(Cart).where(Cart.id == session_id).values(revision=Cart.revision + 1))
    return db.get(Cart, session_id)  # type: ignore[return-value]


def cart_view(db: Session, session_id: str, *, check_stock: bool = False) -> dict:
    rows = db.execute(
        select(CartItem, Variant, Product, Inventory)
        .join(Variant, CartItem.variant_id == Variant.id)
        .join(Product, Variant.product_id == Product.id)
        .join(Inventory, Inventory.variant_id == Variant.id)
        .where(CartItem.cart_id == session_id)
        .order_by(Variant.id)
    ).all()
    items = []
    total = Decimal("0.00")
    for item, variant, product, stock in rows:
        if check_stock and item.quantity > stock.available:
            raise HTTPException(409, "insufficient_stock")
        subtotal = variant.price * item.quantity
        total += subtotal
        items.append(
            dict(
                id=item.id,
                variant_id=variant.id,
                title=product.title,
                sku=variant.sku,
                color=variant.color,
                size=variant.size,
                quantity=item.quantity,
                unit_price=str(variant.price),
                subtotal=str(subtotal),
                available=stock.available,
            )
        )
    return dict(items=items, total=str(total), currency="USD")


def owned_order(db: Session, session_id: str, order_id: str) -> Order:
    order = db.scalar(select(Order).where(Order.id == order_id, Order.cart_id == session_id))
    if order is None:
        raise HTTPException(404, "order_not_found")
    return order


def order_view(db: Session, order: Order) -> dict:
    items = db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    return dict(
        id=order.id,
        status=order.status,
        expires_at=as_utc(order.expires_at).isoformat() if order.expires_at else None,
        cancellation_reason=order.cancellation_reason,
        total=str(order.total),
        currency=order.currency,
        payment_enabled=False,
        message="支付暂未开放",
        items=[
            dict(
                id=i.id,
                variant_id=i.variant_id,
                title=i.title,
                sku=i.sku,
                color=i.color,
                size=i.size,
                quantity=i.quantity,
                unit_price=str(i.unit_price),
            )
            for i in items
        ],
    )


def create_order(db: Session, session_id: str, key: str) -> dict:
    lock_cart(db, session_id)
    existing = db.scalar(
        select(Order).where(Order.cart_id == session_id, Order.idempotency_key == key)
    )
    if existing:
        expire_if_due(db, existing)
        return order_view(db, existing)
    cart = cart_view(db, session_id, check_stock=True)
    if not cart["items"]:
        raise HTTPException(409, "empty_cart")
    order = Order(
        cart_id=session_id,
        idempotency_key=key,
        total=Decimal(cart["total"]),
        expires_at=datetime.now(UTC) + timedelta(seconds=settings.reservation_ttl_seconds),
    )
    db.add(order)
    db.flush()
    for item in cart["items"]:
        # Atomic compare-and-decrement prevents oversell across different sessions.
        changed = db.execute(
            update(Inventory)
            .where(
                Inventory.variant_id == item["variant_id"], Inventory.available >= item["quantity"]
            )
            .values(
                available=Inventory.available - item["quantity"],
                reserved=Inventory.reserved + item["quantity"],
            )
        )
        if changed.rowcount != 1:  # type: ignore[attr-defined]
            raise HTTPException(409, "insufficient_stock")
        db.add(
            OrderItem(
                order_id=order.id,
                **{k: item[k] for k in ("variant_id", "title", "sku", "color", "size", "quantity")},
                unit_price=Decimal(item["unit_price"]),
            )
        )
        db.add(
            Reservation(order_id=order.id, variant_id=item["variant_id"], quantity=item["quantity"])
        )
        audit(
            db,
            item["variant_id"],
            "inventory_reserved",
            order_id=order.id,
            quantity=item["quantity"],
        )
    audit(
        db,
        order.id,
        "order_created",
        status="pending_payment",
        total=cart["total"],
        expires_at=order.expires_at.isoformat() if order.expires_at else None,
    )
    db.execute(delete(CartItem).where(CartItem.cart_id == session_id))
    db.flush()
    return order_view(db, order)


def as_utc(value: datetime) -> datetime:
    # SQLite returns timezone-naive datetimes; PostgreSQL returns aware datetimes.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def release_order(db: Session, order: Order, reason: str) -> None:
    """Caller must hold the cart write lock before reading the order."""
    if order.status != "pending_payment":
        return
    reservations = db.scalars(
        select(Reservation)
        .where(Reservation.order_id == order.id, Reservation.status == "active")
        .order_by(Reservation.variant_id)
    ).all()
    for reservation in reservations:
        db.execute(
            update(Inventory)
            .where(Inventory.variant_id == reservation.variant_id)
            .values(
                available=Inventory.available + reservation.quantity,
                reserved=Inventory.reserved - reservation.quantity,
            )
        )
        reservation.status = "released"
        audit(
            db,
            reservation.variant_id,
            "inventory_released",
            order_id=order.id,
            quantity=reservation.quantity,
            reason=reason,
        )
    order.status = "cancelled"
    order.cancellation_reason = reason
    audit(
        db,
        order.id,
        "order_expired" if reason == "expired" else "order_cancelled",
        status="cancelled",
        reason=reason,
    )
    db.flush()


def expire_if_due(db: Session, order: Order, *, now: datetime | None = None) -> bool:
    """Must run under the same session/cart lock used by checkout and cancellation."""
    if (
        order.status != "pending_payment"
        or order.expires_at is None
        or as_utc(order.expires_at) > as_utc(now or datetime.now(UTC))
    ):
        return False
    release_order(db, order, "expired")
    return True


def cancel_order(db: Session, session_id: str, order_id: str) -> dict:
    lock_cart(db, session_id)
    order = owned_order(db, session_id, order_id)
    if not expire_if_due(db, order):
        release_order(db, order, "customer_cancelled")
    return order_view(db, order)


class MockPaymentProvider:
    def create_session(self, db: Session, order: Order) -> dict:
        payment = db.scalar(select(Payment).where(Payment.order_id == order.id))
        if payment is None:
            payment = Payment(order_id=order.id)
            db.add(payment)
            db.flush()
            db.add(PaymentEvent(payment_id=payment.id, event="payment_disabled"))
        return dict(
            code="payment_disabled",
            payment_enabled=False,
            provider="mock",
            charged=False,
            order_id=order.id,
            order_status=order.status,
            message="支付暂未开放",
        )
