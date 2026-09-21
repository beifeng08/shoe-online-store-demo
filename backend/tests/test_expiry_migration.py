from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.application.commerce import as_utc
from app.config import settings
from app.infrastructure.database import make_engine


def test_upgrade_preserves_populated_orders_and_grants_grace(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'migration.db').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "41e28c896353")
    engine = make_engine(url)
    with engine.begin() as db:
        db.execute(text("INSERT INTO carts (id, revision) VALUES ('cart', 0)"))
        for status in ["pending_payment", "cancelled"]:
            db.execute(
                text("""INSERT INTO orders
                (id, cart_id, idempotency_key, status, total, currency, created_at)
                VALUES (:status, 'cart', :status, :status, 118.00, 'USD', '2020-01-01')"""),
                {"status": status},
            )
    before = datetime.now(UTC)
    command.upgrade(config, "head")
    with engine.connect() as db:
        rows = db.execute(text("SELECT * FROM orders ORDER BY status")).mappings().all()
        assert len(rows) == 2
        assert rows[0]["expires_at"] is None
        deadline = as_utc(datetime.fromisoformat(rows[1]["expires_at"]))
        assert before + timedelta(minutes=30) <= deadline
        assert deadline <= datetime.now(UTC) + timedelta(minutes=30)
        assert rows[1]["status"] == "pending_payment"
        assert rows[1]["total"] == 118
    command.downgrade(config, "41e28c896353")
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM orders")) == 2
        assert "expires_at" not in {c["name"] for c in inspect(db).get_columns("orders")}
    engine.dispose()
