import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.application import commerce as service
from app.application import expiry
from app.application.commerce import as_utc
from app.config import Settings, settings
from app.domain.models import AuditLog, Inventory, Order, OrderItem, Reservation
from app.main import app, lifespan


def place_order(client, variant, quantity=2, key=None):
    added = client.post(
        "/api/v1/cart/items",
        json={
            "variant_id": variant["id"],
            "quantity": quantity,
        },
    )
    assert added.status_code == 200
    response = client.post(
        "/api/v1/checkout/create-order",
        headers={
            "Idempotency-Key": key or str(uuid4()),
        },
    )
    assert response.status_code == 200
    return response.json()


def set_deadline(engine, order_id, deadline):
    with Session(engine) as db, db.begin():
        db.get(Order, order_id).expires_at = deadline


def assert_released_once(engine, variant, order_id):
    with Session(engine) as db:
        order = db.get(Order, order_id)
        assert order.status == "cancelled"
        assert order.cancellation_reason == "expired"
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (10, 0)
        reservation = db.scalar(select(Reservation).where(Reservation.order_id == order_id))
        assert reservation.status == "released"
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.entity_id == order_id,
                    AuditLog.action == "order_expired",
                )
            )
            == 1
        )
        released = db.scalars(
            select(AuditLog).where(
                AuditLog.entity_id == variant["id"],
                AuditLog.action == "inventory_released",
            )
        ).all()
        assert len(released) == 1
        assert released[0].details["reason"] == "expired"


def test_new_deadline_is_server_owned_and_immutable_on_retry(commerce, variant, monkeypatch):
    client, engine = commerce
    monkeypatch.setattr(settings, "reservation_ttl_seconds", 60)
    before = datetime.now(UTC)
    order = place_order(client, variant, key="stable-key")
    deadline = datetime.fromisoformat(order["expires_at"])
    assert before + timedelta(seconds=60) <= deadline
    assert deadline <= datetime.now(UTC) + timedelta(seconds=60)
    monkeypatch.setattr(settings, "reservation_ttl_seconds", 3600)
    retry = client.post(
        "/api/v1/checkout/create-order",
        headers={"Idempotency-Key": "stable-key"},
        json={"expires_at": "2099-01-01T00:00:00Z", "status": "paid"},
    ).json()
    assert retry["expires_at"] == order["expires_at"]
    assert retry["id"] == order["id"]
    assert (
        expiry.expire_due_orders(sessionmaker(engine), now=deadline - timedelta(microseconds=1))
        == 0
    )
    assert expiry.expire_due_orders(sessionmaker(engine), now=deadline) == 1
    assert_released_once(engine, variant, order["id"])


def test_expired_idempotency_returns_original_order_without_relocking(commerce, variant):
    client, engine = commerce
    order = place_order(client, variant, key="expired-key")
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    # A newly added cart must survive retrying the old order key.
    client.post("/api/v1/cart/items", json={"variant_id": variant["id"], "quantity": 1})
    response = client.post(
        "/api/v1/checkout/create-order", headers={"Idempotency-Key": "expired-key"}
    )
    assert response.json()["id"] == order["id"]
    assert response.json()["cancellation_reason"] == "expired"
    assert response.json()["items"] == order["items"]
    assert client.get("/api/v1/cart").json()["items"][0]["quantity"] == 1
    assert_released_once(engine, variant, order["id"])


@pytest.mark.parametrize("endpoint", ["read", "cancel", "payment"])
def test_order_endpoints_expire_due_orders_with_sweeper_disabled(commerce, variant, endpoint):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    path = f"/api/v1/orders/{order['id']}"
    if endpoint == "read":
        response = client.get(path)
    elif endpoint == "cancel":
        response = client.post(path + "/cancel")
    else:
        response = client.post("/api/v1/payments/session", json={"order_id": order["id"]})
        assert response.json()["code"] == "payment_disabled"
        assert response.json()["charged"] is False
    assert response.status_code == 200
    assert_released_once(engine, variant, order["id"])


def test_expiry_keeps_owner_checks(commerce, variant):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    assert (
        client.get(
            f"/api/v1/orders/{order['id']}", headers={"X-Session-ID": str(uuid4())}
        ).status_code
        == 404
    )
    with Session(engine) as db:
        assert db.get(Order, order["id"]).status == "pending_payment"


def test_overlapping_workers_and_cancel_release_once(commerce, variant):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    sessions = sessionmaker(engine)
    with ThreadPoolExecutor(max_workers=5) as pool:
        jobs = [pool.submit(expiry.expire_due_orders, sessions) for _ in range(4)]
        cancel = pool.submit(client.post, f"/api/v1/orders/{order['id']}/cancel")
        assert sum(job.result() for job in jobs) <= 1
        assert cancel.result().status_code == 200
    assert expiry.expire_due_orders(sessions) == 0
    assert_released_once(engine, variant, order["id"])


def test_customer_cancelled_orders_keep_reason_and_stock(commerce, variant):
    client, engine = commerce
    order = place_order(client, variant)
    cancelled = client.post(f"/api/v1/orders/{order['id']}/cancel").json()
    assert cancelled["cancellation_reason"] == "customer_cancelled"
    assert (
        expiry.expire_due_orders(sessionmaker(engine), now=datetime.now(UTC) + timedelta(days=1))
        == 0
    )
    with Session(engine) as db:
        assert db.get(Inventory, variant["id"]).available == 10
        assert db.get(Order, order["id"]).cancellation_reason == "customer_cancelled"


def test_bounded_batch_catches_up_and_retains_snapshots(commerce, variant):
    client, engine = commerce
    orders = [place_order(client, variant, quantity=1) for _ in range(3)]
    future = datetime.now(UTC) + timedelta(days=1)
    sessions = sessionmaker(engine)
    assert expiry.expire_due_orders(sessions, now=future, batch_size=2) == 2
    assert expiry.expire_due_orders(sessions, now=future, batch_size=2) == 1
    assert expiry.expire_due_orders(sessions, now=future, batch_size=2) == 0
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(OrderItem)) == 3
        assert db.get(Inventory, variant["id"]).available == 10
        assert all(db.get(Order, order["id"]).status == "cancelled" for order in orders)


def test_expiry_rolls_back_release_and_audit_together(commerce, variant, monkeypatch):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    original = service.audit

    def fail(db, entity, action, **details):
        original(db, entity, action, **details)
        if action == "order_expired":
            raise HTTPException(500, "injected_failure")

    monkeypatch.setattr(service, "audit", fail)
    with pytest.raises(HTTPException):
        expiry.expire_due_orders(sessionmaker(engine))
    with Session(engine) as db:
        assert db.get(Order, order["id"]).status == "pending_payment"
        stock = db.get(Inventory, variant["id"])
        assert (stock.available, stock.reserved) == (8, 2)
        assert db.scalar(select(Reservation)).status == "active"
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.action == "inventory_released",
                )
            )
            == 0
        )
    monkeypatch.setattr(service, "audit", original)
    assert expiry.expire_due_orders(sessionmaker(engine)) == 1
    assert_released_once(engine, variant, order["id"])


def test_lifespan_releases_without_requests_and_stops(commerce, variant, monkeypatch):
    client, engine = commerce
    order = place_order(client, variant)
    set_deadline(engine, order["id"], datetime.now(UTC) - timedelta(seconds=1))
    completed = Event()
    original = expiry.expire_due_orders
    calls = []

    def sweep():
        calls.append(original(sessionmaker(engine)))
        completed.set()

    monkeypatch.setattr(expiry, "expire_due_orders", sweep)
    monkeypatch.setattr(settings, "reservation_sweeper_enabled", True)

    async def exercise():
        async with lifespan(app):
            assert await asyncio.to_thread(completed.wait, 5)
        assert calls == [1]

    asyncio.run(exercise())
    assert_released_once(engine, variant, order["id"])


def test_worker_recovers_after_transient_error(monkeypatch, caplog):
    calls = []
    monkeypatch.setattr(settings, "reservation_sweep_seconds", 0.01)

    async def exercise():
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()

        def sweep():
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("temporary failure")
            loop.call_soon_threadsafe(stop.set)

        monkeypatch.setattr(expiry, "expire_due_orders", sweep)
        await asyncio.wait_for(expiry.expiry_loop(stop), timeout=5)

    asyncio.run(exercise())
    assert len(calls) == 2
    assert "reservation_sweep_failed" in caplog.text


def test_deadline_normalization_and_invalid_config():
    aware = datetime(2026, 9, 21, tzinfo=UTC)
    assert as_utc(aware.replace(tzinfo=None)) == aware
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Settings(reservation_ttl_seconds=0)
