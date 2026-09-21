from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def identifier() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Product(Base):
    __tablename__ = "products"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    handle: Mapped[str] = mapped_column(String(100), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(4000))


class Variant(Base):
    __tablename__ = "product_variants"
    __table_args__ = (
        UniqueConstraint("product_id", "color", "size"),
        CheckConstraint("price >= 0"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    sku: Mapped[str] = mapped_column(String(160), unique=True)
    color: Mapped[str] = mapped_column(String(100))
    color_hex: Mapped[str] = mapped_column(String(7))
    size: Mapped[int]
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")


class Media(Base):
    __tablename__ = "product_media"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    color: Mapped[str | None] = mapped_column(String(100))
    position: Mapped[int]


class Cart(Base):
    __tablename__ = "carts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    revision: Mapped[int] = mapped_column(default=0)


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("cart_id", "variant_id"), CheckConstraint("quantity > 0"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    cart_id: Mapped[str] = mapped_column(ForeignKey("carts.id"), index=True)
    variant_id: Mapped[str] = mapped_column(ForeignKey("product_variants.id"))
    quantity: Mapped[int]


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (CheckConstraint("available >= 0"), CheckConstraint("reserved >= 0"))
    variant_id: Mapped[str] = mapped_column(ForeignKey("product_variants.id"), primary_key=True)
    available: Mapped[int]
    reserved: Mapped[int] = mapped_column(default=0)


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("cart_id", "idempotency_key"),
        CheckConstraint("status IN ('pending_payment', 'cancelled')"),
        CheckConstraint("total >= 0"),
        Index("ix_orders_status_expires_at", "status", "expires_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    cart_id: Mapped[str] = mapped_column(ForeignKey("carts.id"), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(30), default="pending_payment")
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_reason: Mapped[str | None] = mapped_column(String(30))


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("quantity > 0"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    variant_id: Mapped[str] = mapped_column(ForeignKey("product_variants.id"))
    title: Mapped[str] = mapped_column(String(200))
    sku: Mapped[str] = mapped_column(String(160))
    color: Mapped[str] = mapped_column(String(100))
    size: Mapped[int]
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    quantity: Mapped[int]


class Reservation(Base):
    __tablename__ = "inventory_reservations"
    __table_args__ = (
        UniqueConstraint("order_id", "variant_id"),
        CheckConstraint("quantity > 0"),
        CheckConstraint("status IN ('active', 'released')"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    variant_id: Mapped[str] = mapped_column(ForeignKey("product_variants.id"))
    quantity: Mapped[int]
    status: Mapped[str] = mapped_column(String(20), default="active")


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (CheckConstraint("status = 'disabled'"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), unique=True)
    provider: Mapped[str] = mapped_column(String(30), default="mock")
    status: Mapped[str] = mapped_column(String(30), default="disabled")


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    payment_id: Mapped[str] = mapped_column(ForeignKey("payments.id"))
    event: Mapped[str] = mapped_column(String(80))


class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    __table_args__ = (UniqueConstraint("provider", "external_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    provider: Mapped[str] = mapped_column(String(50))
    external_id: Mapped[str] = mapped_column(String(200))
    payload: Mapped[dict] = mapped_column(JSON)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    entity_id: Mapped[str] = mapped_column(String(80), index=True)
    action: Mapped[str] = mapped_column(String(80))
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
