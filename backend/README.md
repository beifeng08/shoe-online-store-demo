# Python commerce MVP

Python 3.12+ / FastAPI / Pydantic / SQLAlchemy 2 / Alembic. No Redis, paid service,
external webhook, or real payment provider is required. All amounts are calculated
with Decimal and serialized as decimal strings. The only provider is
`MockPaymentProvider`: `payment_disabled`, `charged=false`; it cannot mark an order paid.

## Local setup (PowerShell, from repository root)

```powershell
python3.12 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.lock
Copy-Item backend/.env.example backend/.env
cd backend
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m app.seed
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

If using `uv` (the environment used during implementation):

```powershell
uv venv --python python3.12 backend/.venv
uv pip install --python backend/.venv/Scripts/python.exe -r backend/requirements-dev.lock
```

For macOS/Linux use `python3.12` and `.venv/bin/python`. The lock file pins the
versions actually verified. To resolve fresh versions from `pyproject.toml`, use
`uv pip install --python .venv/Scripts/python.exe -r pyproject.toml --extra dev`
from `backend/`.

Run from `backend/`: default database is `backend/commerce.db`. Backend `.env`
is resolved independently of the Next.js environment. Set `DATABASE_URL` to
`postgresql+psycopg://user:password@localhost:5432/evoloop` for PostgreSQL, then run
the same Alembic and seed commands. Do not point Python at the old TypeScript
SQLite file: these are separate schemas during migration.

## Database lifecycle

`migrations/versions/41e28c896353_initial_commerce.py` explicitly creates 13 tables:
products, product_variants, product_media, carts, cart_items, inventory,
inventory_reservations, orders, order_items, payments, payment_events,
webhook_events, audit_logs. Application startup never runs `create_all`/DDL.

`alembic upgrade head` applies migrations; `alembic check` checks ORM/schema drift.
`alembic downgrade base` destroys these tables and data: use only on a disposable DB.
Subsequent changes require a new reviewed Alembic revision.

`python -m app.seed` explicitly imports `data/catalog.json` (29 existing products),
with 10 demo units per sellable color/size variant. Variants have deterministic
UUIDv5 IDs derived from handle + color name + canonical EU size, never array order.
Once imported, IDs are persisted; changing display names should retain those IDs.
Repeated seeding skips existing products and never resets prices or inventory.
The snapshot was generated using `node scripts/export-commerce-catalog.mjs` at
repository root. Regenerate intentionally; this is not automatic catalog sync.
Supplier assets/data retain the repository's LICENSE-ASSETS restrictions.

## API

`GET /health` verifies migration metadata is readable. Interactive API docs:
`http://127.0.0.1:8000/docs`.

| Method | Path | Input |
|---|---|---|
| GET | /api/v1/catalog/products | Public catalog |
| GET | /api/v1/catalog/products/{handle} | Explicit variants, price strings, available stock |
| GET | /api/v1/cart | Anonymous session |
| POST | /api/v1/cart/items | `{ "variant_id": "UUID", "quantity": 1 }` |
| PATCH | /api/v1/cart/items/{item_id} | `{ "quantity": 2 }` |
| DELETE | /api/v1/cart/items/{item_id} | Anonymous session |
| POST | /api/v1/checkout/preview | Re-read prices and check inventory |
| POST | /api/v1/checkout/create-order | `Idempotency-Key` header, 8–128 characters |
| GET | /api/v1/orders/{order_id} | Only owner session |
| POST | /api/v1/orders/{order_id}/cancel | Idempotent cancellation and stock release |
| POST | /api/v1/payments/session | `{ "order_id": "UUID" }`; always disabled |

All non-public APIs require `X-Session-ID: <random UUID>` (a bearer credential).
In the storefront, Next creates this credential in an HttpOnly, SameSite=Lax
cookie (Secure over HTTPS); callers cannot override it with a browser header.
The Next proxy checks same-origin writes, uses a route allowlist, does not cache
commerce responses and has a 20-second upstream timeout. Bind Python to loopback
for the local MVP. No CORS middleware is needed.

Session ownership is enforced for cart items, orders and payment requests. Quantity
must be an integer from 1 to 99. Prices, stock and statuses sent by a client are
ignored. Creating an order re-reads persisted variant prices, snapshots title/SKU/
color/size/unit price, reserves inventory and clears the cart in one transaction.
Each transaction commits before FastAPI sends its response.

A cart row write lock serializes mutations within a session. Across sessions,
conditional SQL inventory updates prevent overselling; inventory rows are updated
in a stable variant-ID order. A unique `(cart_id, idempotency_key)` plus the session
lock prevents duplicate orders, including concurrent requests and lost-response
retries. The first successful order is the durable result of that key, even after
cancel or subsequent cart edits. The UI retains an uncertain key in sessionStorage
until it receives the order. Audit logs are committed with inventory/order changes.

## Checks

```powershell
cd backend
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m ruff check app migrations tests
.venv/Scripts/python.exe -m ruff format --check app migrations tests
.venv/Scripts/python.exe -m mypy
.venv/Scripts/python.exe -m alembic check
cd ..
backend/.venv/Scripts/python.exe -m compileall backend
# Optional live HTTP integration check, with both services already running:
backend/.venv/Scripts/python.exe scripts/smoke-commerce.py
```

Tests apply actual Alembic migrations to disposable SQLite databases, never runtime
ORM auto-creation. They cover price tampering, snapshots, stock, ownership,
concurrent idempotency and competing sessions. PostgreSQL-compatible schema/SQL
is provided, but PostgreSQL runtime integration has not been executed locally.

## MVP limitations

- Pending orders reserve stock until explicitly cancelled; no automatic expiry.
- Losing the anonymous cookie loses access to orders; no account recovery or admin UI.
- The original TS display/search/AI catalog remains. Python is authoritative for
  purchasable variants, prices, inventory, carts and orders. Future catalog edits
  need an explicit migration/sync decision; no automatic dual writes are performed.
- Inventory quantities and supplier-derived demo prices are fixtures, not live stock.
- Total is the item subtotal in USD; no shipping, tax, discounts or payment processing.
- SQLite serializes writes; PostgreSQL should be load-tested before multi-instance use.
- No real payment, Shopify sync, external webhook, login, refunds, logistics or queue.
