from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.application import commerce as service
from app.domain.models import AuditLog, Inventory, Order, OrderItem, Product, Reservation, Variant
from app.seed import seed


def test_failure_after_reservation_rolls_back_every_write(commerce, variant, monkeypatch):
    client, engine = commerce
    add(client, variant, 2)
    original_audit = service.audit

    def fail_after_reserving(db, entity, action, **details):
        original_audit(db, entity, action, **details)
        if action == "order_created":
            raise HTTPException(409, "simulated_transaction_failure")

    monkeypatch.setattr(service, "audit", fail_after_reserving)
    assert checkout(client).status_code == 409
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 0
        assert db.scalar(select(func.count()).select_from(Reservation)) == 0
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "inventory_reserved")
            )
            == 0
        )
    assert client.get("/api/v1/cart").json()["items"][0]["quantity"] == 2


@pytest.mark.parametrize("quantity", [0, -1, 100, 1.5, True, "2"])
def test_invalid_cart_quantities(commerce, variant, quantity):
    client, _ = commerce
    assert add(client, variant, quantity).status_code == 422


def add(client, variant, quantity=1, **extra):
    return client.post(
        "/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": quantity, **extra}
    )


def checkout(client, key="test-order-key", **kwargs):
    return client.post("/api/v1/checkout/create-order", headers={"Idempotency-Key": key}, **kwargs)


def test_health_catalog_and_stable_variants(commerce):
    client, engine = commerce
    assert client.get("/health").json() == {"status": "ok", "payment_enabled": False}
    products = client.get("/api/v1/catalog/products").json()
    assert len(products) == 29
    product = client.get("/api/v1/catalog/products/dc-1001").json()
    assert len(product["variants"]) == 50
    assert len({v["id"] for p in products for v in p["variants"]}) == sum(
        len(p["variants"]) for p in products
    )
    assert client.get("/api/v1/catalog/products/missing").status_code == 404
    with Session(engine) as db, db.begin():
        seed(db)
    assert client.get("/api/v1/catalog/products/dc-1001").json() == product


def test_cart_add_patch_delete_and_ownership(commerce, variant):
    client, _ = commerce
    assert client.get("/api/v1/cart").json()["items"] == []
    item = add(client, variant, 2).json()["items"][0]
    assert add(client, variant).json()["items"][0]["quantity"] == 3
    path = f"/api/v1/cart/items/{item['id']}"
    assert client.patch(path, json={"quantity": 4}).json()["items"][0]["quantity"] == 4
    assert client.patch(path, json={"quantity": 0}).status_code == 422
    assert client.patch(path, json={"quantity": 1.5}).status_code == 422
    assert client.delete(path, headers={"X-Session-ID": str(uuid4())}).status_code == 404
    assert client.delete(path).json()["items"] == []


def test_price_recomputed_and_snapshot_immutable(commerce, variant):
    client, engine = commerce
    add(client, variant, 3, price="0.01", unit_price="0.01", available=999, status="paid")
    with Session(engine) as db, db.begin():
        db.get(Variant, variant["id"]).price = Decimal("19.99")
    assert client.post("/api/v1/checkout/preview").json()["total"] == "59.97"
    order = checkout(client, json={"total": "0.01", "status": "paid"}).json()
    assert order["total"] == "59.97"
    assert order["status"] == "pending_payment"
    with Session(engine) as db, db.begin():
        db.get(Variant, variant["id"]).price = Decimal("88.00")
        db.get(Product, "evo-01").title = "Changed title"
    snapshot = client.get(f"/api/v1/orders/{order['id']}").json()
    assert snapshot["total"] == "59.97"
    assert snapshot["items"][0]["title"] == "Urban Bloom"
    assert snapshot["items"][0]["unit_price"] == "19.99"
    assert snapshot["items"][0]["sku"] == variant["sku"]


def test_short_stock_rolls_back_order_and_cart(commerce, variant):
    client, engine = commerce
    add(client, variant, 11)
    assert checkout(client).status_code == 409
    assert client.post("/api/v1/checkout/preview").status_code == 409
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 0
        assert db.get(Inventory, variant["id"]).available == 10
    assert client.get("/api/v1/cart").json()["items"][0]["quantity"] == 11


def test_reserve_idempotency_cancel_and_audit(commerce, variant):
    client, engine = commerce
    add(client, variant, 2)
    order = checkout(client).json()
    assert order["status"] == "pending_payment"
    assert checkout(client).json()["id"] == order["id"]
    assert client.get("/api/v1/cart").json()["items"] == []
    with Session(engine) as db:
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (8, 2)
        assert db.scalar(select(func.count()).select_from(Order)) == 1
        assert db.scalar(select(func.count()).select_from(OrderItem)) == 1
    path = f"/api/v1/orders/{order['id']}"
    outsider = {"X-Session-ID": str(uuid4())}
    assert client.get(path, headers=outsider).status_code == 404
    assert client.post(path + "/cancel", headers=outsider).status_code == 404
    assert client.post(path + "/cancel").json()["status"] == "cancelled"
    assert client.post(path + "/cancel").json()["status"] == "cancelled"
    with Session(engine) as db:
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
        assert db.scalar(select(Reservation)).status == "released"
        actions = list(db.scalars(select(AuditLog.action)))
        for action in [
            "order_created",
            "order_cancelled",
            "inventory_reserved",
            "inventory_released",
        ]:
            assert actions.count(action) == 1


def test_mock_never_charges_or_marks_paid(commerce, variant):
    client, _ = commerce
    add(client, variant)
    order = checkout(client).json()
    for _ in range(2):
        result = client.post("/api/v1/payments/session", json={"order_id": order["id"]}).json()
        assert result["code"] == "payment_disabled"
        assert result["charged"] is False
        assert result["message"] == "支付暂未开放"
    assert client.get(f"/api/v1/orders/{order['id']}").json()["status"] == "pending_payment"
    assert (
        client.post(
            "/api/v1/payments/session",
            json={"order_id": order["id"]},
            headers={"X-Session-ID": str(uuid4())},
        ).status_code
        == 404
    )


def test_concurrent_duplicate_checkout(commerce, variant):
    client, engine = commerce
    add(client, variant, 2)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: checkout(client), range(4)))
    assert all(r.status_code == 200 for r in results)
    assert len({r.json()["id"] for r in results}) == 1
    with Session(engine) as db:
        assert db.get(Inventory, variant["id"]).reserved == 2


def test_competing_sessions_cannot_oversell(commerce, variant):
    client, engine = commerce
    sessions = [str(uuid4()), str(uuid4())]
    for sid in sessions:
        client.post(
            "/api/v1/cart/items",
            headers={"X-Session-ID": sid},
            json={"variant_id": variant["id"], "quantity": 7},
        )

    def buy(sid):
        return client.post(
            "/api/v1/checkout/create-order",
            headers={"X-Session-ID": sid, "Idempotency-Key": "race-key"},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(buy, sessions))
    assert sorted(r.status_code for r in results) == [200, 409]
    with Session(engine) as db:
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (3, 7)


def test_session_and_idempotency_required(commerce, variant):
    client, _ = commerce
    assert checkout(client).status_code == 409
    add(client, variant)
    assert client.post("/api/v1/checkout/create-order").status_code == 422
    assert client.get("/api/v1/cart", headers={"X-Session-ID": "guess"}).status_code == 422
