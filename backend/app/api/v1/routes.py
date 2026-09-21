from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.application.commerce import (
    MockPaymentProvider,
    cancel_order,
    cart_view,
    create_order,
    lock_cart,
    order_view,
    owned_order,
)
from app.dependencies import anonymous_session, database
from app.domain.models import CartItem, Inventory, Media, Product, Variant
from app.schemas.commerce import AddItem, PaymentRequest, Quantity

router = APIRouter(prefix="/api/v1")
DB = Annotated[Session, Depends(database, scope="function")]
SessionID = Annotated[str, Depends(anonymous_session)]


def product_view(db: Session, product: Product) -> dict:
    variants = db.execute(
        select(Variant, Inventory)
        .join(Inventory)
        .where(Variant.product_id == product.id)
        .order_by(Variant.color, Variant.size)
    ).all()
    media = db.scalars(select(Media).where(Media.product_id == product.id).order_by(Media.position))
    return dict(
        id=product.id,
        handle=product.handle,
        title=product.title,
        description=product.description,
        media=[dict(url=m.url, color=m.color) for m in media],
        variants=[
            dict(
                id=v.id,
                sku=v.sku,
                color=v.color,
                color_hex=v.color_hex,
                size=v.size,
                price=str(v.price),
                currency=v.currency,
                available=i.available,
            )
            for v, i in variants
        ],
    )


@router.get("/catalog/products")
def products(db: DB) -> list[dict]:
    return [product_view(db, p) for p in db.scalars(select(Product).order_by(Product.handle))]


@router.get("/catalog/products/{handle}")
def product(handle: str, db: DB) -> dict:
    p = db.scalar(select(Product).where(Product.handle == handle))
    if p is None:
        raise HTTPException(404, "product_not_found")
    return product_view(db, p)


@router.get("/cart")
def cart(db: DB, sid: SessionID) -> dict:
    return cart_view(db, sid)


@router.post("/cart/items")
def add_item(body: AddItem, db: DB, sid: SessionID) -> dict:
    lock_cart(db, sid)
    variant_id = str(body.variant_id)
    if db.get(Variant, variant_id) is None:
        raise HTTPException(404, "variant_not_found")
    item = db.scalar(
        select(CartItem).where(CartItem.cart_id == sid, CartItem.variant_id == variant_id)
    )
    quantity = body.quantity + (item.quantity if item else 0)
    if quantity > 99:
        raise HTTPException(422, "quantity_limit")
    if item:
        item.quantity = quantity
    else:
        db.add(CartItem(cart_id=sid, variant_id=variant_id, quantity=quantity))
    db.flush()
    return cart_view(db, sid)


def owned_item(db: Session, sid: str, item_id: str) -> CartItem:
    item = db.scalar(select(CartItem).where(CartItem.id == item_id, CartItem.cart_id == sid))
    if item is None:
        raise HTTPException(404, "item_not_found")
    return item


@router.patch("/cart/items/{item_id}")
def patch_item(item_id: str, body: Quantity, db: DB, sid: SessionID) -> dict:
    lock_cart(db, sid)
    owned_item(db, sid, item_id).quantity = body.quantity
    db.flush()
    return cart_view(db, sid)


@router.delete("/cart/items/{item_id}")
def delete_item(item_id: str, db: DB, sid: SessionID) -> dict:
    lock_cart(db, sid)
    db.delete(owned_item(db, sid, item_id))
    db.flush()
    return cart_view(db, sid)


@router.post("/checkout/preview")
def preview(db: DB, sid: SessionID) -> dict:
    return cart_view(db, sid, check_stock=True)


@router.post("/checkout/create-order")
def checkout(
    db: DB, sid: SessionID, idempotency_key: Annotated[str, Header(min_length=8, max_length=128)]
) -> dict:
    return create_order(db, sid, idempotency_key)


@router.get("/orders/{order_id}")
def get_order(order_id: str, db: DB, sid: SessionID) -> dict:
    return order_view(db, owned_order(db, sid, order_id))


@router.post("/orders/{order_id}/cancel")
def cancel(order_id: str, db: DB, sid: SessionID) -> dict:
    return cancel_order(db, sid, order_id)


@router.post("/payments/session")
def payment(body: PaymentRequest, db: DB, sid: SessionID, response: Response) -> dict:
    lock_cart(db, sid)
    order = owned_order(db, sid, str(body.order_id))
    response.status_code = 200  # Machine-readable disabled result, never a payment success.
    return MockPaymentProvider().create_session(db, order)
