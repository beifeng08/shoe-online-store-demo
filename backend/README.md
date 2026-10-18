# Python commerce MVP

> 2026-10-03: product/variant availability now has an explicit, audited reconciliation
> command. Cart and checkout re-read Python sale state while historical orders remain
> readable and cancellable. SQLite/PostgreSQL tests and migration verification are
> recorded in [the availability report](../docs/catalog-availability-2026-10-03.md).
> Earlier statements below about local PostgreSQL execution describe their dated baseline.

> 2026-10-01: errors now use a safe `{code, detail}` contract with `X-Request-ID`
> correlation. PostgreSQL integration has an opt-in isolated-schema runner and a CI
> job; the real PostgreSQL job has not yet been executed in this local environment.
> See [the reliability report](../docs/reliability-2026-10-01.md).

> 2026-09-30: restored into the main local workspace with strict success response
> contracts, SQLite backup fixtures and framework-independent commerce errors. See
> [the integration report](../docs/unified-baseline-2026-09-30.md) for current verification.
> Business failures return stable `code` values and safe `detail` text while preserving
> status codes. Do not infer complete production authentication or error observability.

Python 3.12+ / FastAPI / Pydantic / SQLAlchemy 2 / Alembic. No Redis, paid service,
external webhook, or real payment provider is required. All amounts are calculated
with Decimal and serialized as decimal strings. The only provider is
`MockPaymentProvider`: `payment_disabled`, `charged=false`; it cannot mark an order paid.

Pending orders reserve inventory for 30 minutes by default. The FastAPI lifespan runs a
bounded in-process sweeper every 30 seconds; `python -m app.expire_orders` also runs one
manual batch. Both paths use the same transactional release code as cancellation.
Each lifespan worker keeps its own transient `(expires_at, id)` cursor and a frozen
UTC cutoff per pass. Failed orders still advance the scan so later healthy orders
can run; an empty batch resets the pass and retries the earlier failures. Candidate
read/close failures leave progress unchanged, and write failures retain the safe
failure signal. A batch accepts 1-1000 candidates; it does not bound query runtime.
Newly due orders wait for the next pass instead of indefinitely extending this one.
This is not a database snapshot: late/backdated records can wait for wrap, and
arbitrary continuous backdating or deadline edits have no strong fairness guarantee.
Restarting a worker loses its cursor. The manual CLI remains a stateless single
batch and can repeatedly encounter a bad oldest prefix; it is not the rotating worker.
An explicit cursor must belong to one serial caller and one database, not be shared
concurrently or reused after timing out a still-running sweep.
The sweep normalizes an explicit `now` to UTC before SQL candidate selection;
naive datetimes are treated as UTC, matching the per-order expiry check. A scan
before the exact deadline does not release stock; repeated scans release at most once. Set
`RESERVATION_TTL_SECONDS`, `RESERVATION_SWEEP_SECONDS`, `RESERVATION_SWEEP_BATCH_SIZE` or
`RESERVATION_SWEEPER_ENABLED=false` in `backend/.env` when needed. No external queue is used.

## Local setup (from repository root, any platform)

Only the virtualenv creation line and the `uv` interpreter path differ by platform; every other
command is identical because `npm run py` resolves the interpreter
(see [../docs/agents/verification.md](../docs/agents/verification.md)).

```bash
python3.12 -m venv backend/.venv        # Windows: py -3.12 -m venv backend/.venv
cp backend/.env.example backend/.env    # do not overwrite an existing backend/.env
npm run py -- -m pip install -r requirements-dev.lock
npm run db:migrate:python
npm run py -- -m app.seed
npm run py -- -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

If using `uv` (the environment used during implementation):

```bash
uv venv --python python3.12 backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements-dev.lock   # Windows: backend/.venv/Scripts/python.exe
```

The lock file pins the versions actually verified. To resolve fresh versions from
`pyproject.toml`, from `backend/` use
`uv pip install --python .venv/bin/python -r pyproject.toml --extra dev`
(Windows: `.venv/Scripts/python.exe`).

Run from `backend/`: default database is `backend/commerce.db`. Backend `.env`
is resolved independently of the Next.js environment. Set `DATABASE_URL` to
`postgresql+psycopg://user:password@localhost:5432/evoloop` for local PostgreSQL, then run
the same Alembic and seed commands. For a production process, set `APP_ENV=production`
and keep it aligned with `NODE_ENV=production`; an `.env` development override is
rejected. Include a real database hostname plus `?sslmode=verify-full` in the URL; startup
and Alembic engine creation fail closed for SQLite, hostless URLs, missing TLS
verification, or weaker PostgreSQL modes. Add
`sslrootcert=/path/to/trusted-ca.pem` when the server certificate is not in the system
trust store. Do not point Python at the old TypeScript SQLite file: these are separate
schemas during migration.

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

## Reviewed availability reconciliation

Apply `alembic upgrade head` before starting this version: revision `c73a28f06b19`
adds non-null `is_active` flags with a true default to products and variants. Existing
identities, prices, inventory and order snapshots are retained.

`app.sync_catalog` accepts a reviewed **full** catalog export, up to 2 MB. A partial
export would retire omitted identities. New product/variant identities or changed
handles are rejected; import or migrate identities explicitly before reconciliation.
From `backend/`, preview first:

```bash
npm run py -- -m app.sync_catalog --catalog data/catalog.json
```

The command returns `source_version`, `plan_version` and all proposed changes as
JSON. SQLite preview uses a read-only connection; PostgreSQL preview uses a read-only
transaction. Apply the same source only after reviewing its output:

```bash
npm run py -- -m app.sync_catalog --catalog data/catalog.json --apply --expect-plan <copy-the-plan_version-from-the-preview>
```

Application locks products in stable ID order, recalculates the plan and rejects a
changed identity set, sale state or restore mode. Missing products/variants become inactive;
rows stay present for carts and historical orders. Only availability flags and
`catalog_availability_changed` audit records are written in one transaction. Prices,
stock and reservations are never copied from the export or reset. A repeat of an
already applied old plan is rejected; a fresh no-change preview can be applied safely.

A later export containing a retired item does not revive it by default, and repeated
seed also preserves retirement. To restore reviewed identities, preview with
`--restore-present`, then apply with that same flag and the new plan version. This
restores sale eligibility only; existing prices and stock still decide checkout.

Public commerce catalog responses omit inactive products and variants. Old cart lines
remain visible with `sellable=false`; remove them before checkout. Adding or changing
inactive lines, previewing checkout and creating a new order return
`409 variant_unavailable`. Retrying a completed order's idempotency key returns its
original order even after retirement. Reads, Mock payment, cancel and expiry keep their
ownership checks and inventory-release rules.

For rollback, use a reviewed `--restore-present` plan if restoring sales is intended.
Migration downgrade refuses any inactive entry to prevent accidental re-enabling.
Do not run older purchase code while inactive entries exist: older code ignores these
flags even if the additive columns remain. Prefer a forward fix retaining the gates.
There is no scheduled sync, price sync, product rename migration or hard deletion.

## API

`GET /health` verifies migration metadata is readable. Interactive API docs:
`http://127.0.0.1:8000/docs`.

| Method | Path                              | Input                                             |
| ------ | --------------------------------- | ------------------------------------------------- |
| GET    | /api/v1/catalog/products          | Public catalog                                    |
| GET    | /api/v1/catalog/products/{handle} | Explicit variants, price strings, available stock |
| GET    | /api/v1/cart                      | Anonymous session                                 |
| POST   | /api/v1/cart/items                | `{ "variant_id": "UUID", "quantity": 1 }`         |
| PATCH  | /api/v1/cart/items/{item_id}      | `{ "quantity": 2 }`                               |
| DELETE | /api/v1/cart/items/{item_id}      | Anonymous session                                 |
| POST   | /api/v1/checkout/preview          | Re-read prices and check inventory                |
| POST   | /api/v1/checkout/create-order     | `Idempotency-Key` header, 8–128 characters        |
| GET    | /api/v1/orders/{order_id}         | Only owner session                                |
| POST   | /api/v1/orders/{order_id}/cancel  | Idempotent cancellation and stock release         |
| POST   | /api/v1/payments/session          | `{ "order_id": "UUID" }`; always disabled         |

All non-public APIs require `X-Session-ID: <random UUID>` (a bearer credential).
In production they also require the server-only `X-Internal-Proxy-Secret`, which
must match `COMMERCE_PROXY_SECRET` and contain at least 32 random bytes. The Next
proxy adds this header; browsers cannot supply or override it. Local development
may leave the secret empty, but a configured secret is always checked.
In the storefront, Next creates this credential in an HttpOnly, SameSite=Lax
cookie (always Secure in production, including TLS-terminating proxies; also Secure
over HTTPS in development); callers cannot override it with a browser header.
The Next proxy checks same-origin writes, bounds non-GET bodies to 16 KiB while
reading (413 before contacting Python on overflow), uses a route allowlist, does
not cache commerce responses and has a 20-second upstream timeout. A cart variant
with no inventory row remains visible as unavailable; preview and checkout reject
it rather than silently creating a partial order and clearing the cart.
Bind Python to loopback
for the local MVP. No CORS middleware is needed.

Business, validation, HTTP routing and unexpected application failures return
`{code, detail}`. Validation failures use `invalid_request` without echoing input;
unexpected failures use `internal_error` without exception text. Every response
has `Cache-Control: no-store` and `X-Request-ID`. Next generates the ID, Python
accepts a well-formed internal UUIDv4, and structured application logs correlate
the same ID with method, route template, status, code and elapsed time. IDs are
diagnostic data, never authentication or idempotency credentials.

Use `--no-access-log` with Uvicorn so the ordinary access logger does not duplicate
raw URLs/query strings. Configure any external proxy logs with the same privacy
policy. Successful streaming/background work after response start is outside
this JSON error boundary; commerce currently uses ordinary JSON responses.

## PostgreSQL integration tests

By default pytest runs SQLite and explicitly skips the PostgreSQL migration test.
To additionally run commerce, ownership, idempotency, concurrent inventory and
failure/response-validation rollback tests on PostgreSQL, provision a dedicated
empty database with a name ending in `_test`, then from `backend/` run:

```bash
# macOS / Linux
COMMERCE_TEST_POSTGRES_URL='postgresql+psycopg://postgres:postgres@127.0.0.1:5432/commerce_test' npm run py -- -B -m pytest -q

# Windows PowerShell
$env:COMMERCE_TEST_POSTGRES_URL = 'postgresql+psycopg://postgres:postgres@127.0.0.1:5432/commerce_test'
npm run py -- -B -m pytest -q
Remove-Item Env:COMMERCE_TEST_POSTGRES_URL
```

The example credentials are for a disposable local test service only. Tests reject
non-PostgreSQL URLs, database names without `_test`, and user-supplied search-path
options. Each test creates a unique `commerce_test_<UUID>` schema, applies Alembic
and seeds it, then drops only that owned schema. The database/role is never dropped.
The role needs schema creation privileges; URLs can retain `sslmode=verify-full`
and trusted CA settings. Normal completion/failure runs cleanup; a killed process
may leave a test schema for later inspection. Never point this runner at production.

`.github/workflows/verify.yml` adds a PostgreSQL 16 service job using this runner.
Its disposable service does not validate production TLS, AI budget transactions
or real payment. A missing local server remains an explicit validation gap, not a pass.

Session ownership is enforced for cart items, orders and payment requests. Quantity
must be an integer from 1 to 99. Prices, stock and statuses sent by a client are
ignored. Creating an order re-reads persisted variant prices, snapshots title/SKU/
color/size/unit price, reserves inventory and clears the cart in one transaction.
Each transaction commits before FastAPI sends its response.

Successful health, catalog, cart, checkout, order and disabled-payment responses are
validated by explicit Pydantic response models and described in OpenAPI. Amounts
remain nonnegative decimal strings with exactly two fractional digits; quantities
and stock remain integers. Only pending/cancelled orders and disabled Mock payments
are accepted. Internal fields are filtered out, including nested product fields.
Response validation runs before the transaction commits: an invalid checkout or
payment response rolls back its writes. These contracts preserve existing response
field names, nullable expiry fields and HTTP status codes; no migration is needed.
Run the response-contract regression checks:

```bash
npm run py -- -m pytest -q tests/test_response_contract.py tests/test_contract_export.py
```

The frontend API types are generated from this application's OpenAPI, with explicit
page projections and runtime validation retained. After changing a response model or
route, regenerate and commit all three artifacts from the repository root:

    npm run contract:generate
    npm run contract:check
    npm run contract:test

Install `backend/requirements-dev.lock` first. The default interpreter is `python`;
set `COMMERCE_PYTHON` to the backend virtual environment's Python when necessary.
`backend/export_contract.py` runs a fresh isolated worker with a runtime environment
allowlist, in-memory database configuration and the sweeper disabled. It skips dotenv
reads and fails on database/network connection attempts; it does not run migrations,
seed data or application lifespan. This is a side-effect guard for trusted repository
code, not a security sandbox for untrusted Python. The worker has a 20-second limit.
On timeout it requests owned process-tree termination and verifies exit before
reporting that the worker was terminated. If termination or verification fails, it
returns a distinct cleanup error without claiming tree exit. All launcher waits
have deadlines. Worker output is collected in temporary files, so a surviving
descendant cannot block pipe closure or leak partial output on a timeout.
Successful export assumes trusted imports do not launch independent background
children: it collects output when the worker launcher exits, not after arbitrary
children finish. Windows timeout verification covers the tree captured at cleanup;
it is not lifecycle supervision for continuously spawning or detached processes.
Generation accepts only local OpenAPI references, including discriminator mappings,
and rejects external example sources.
`contract:check` is read-only and fails if API types, the OpenAPI snapshot or the
Python-validated sample snapshot drift. It is included in `npm run verify` and CI.
The snapshots contain synthetic contract examples, not customer or business data.
Generated types describe full API objects; `src/domain/commerce.ts` retains page
projections and the existing optional cart inventory fields for legacy responses.

Expired orders remain readable with their original line snapshots and order ID, are returned
as `status=cancelled` with `cancellation_reason=expired`, and have `expires_at` in the response.
Reads, cancellation and disabled payment requests perform a due-date check even when the
sweeper is disabled. Retrying an expired idempotency key returns the original order and never
re-locks stock. The migration grants existing pending orders a one-time 30-minute grace period;
terminal historical orders remain unchanged.

A cart row write lock serializes mutations within a session. Across sessions,
conditional SQL inventory updates prevent overselling; inventory rows are updated
in a stable variant-ID order. A unique `(cart_id, idempotency_key)` plus the session
lock prevents duplicate orders, including concurrent requests and lost-response
retries. The first successful order is the durable result of that key, even after
cancel or subsequent cart edits. The UI retains an uncertain key in sessionStorage
until it receives the order. Audit logs are committed with inventory/order changes.

## Checks

```bash
# Everything at once (ruff format + ruff check + mypy + compileall + alembic check + pytest):
npm run verify:python

# Or individually:
npm run check:python:format
npm run check:python:lint
npm run check:python:types
npm run compile:python
npm run check:python:migrate
npm run test:python

# Optional live HTTP integration check, with both services already running:
npm run smoke:commerce
# Alternate local port, using a disposable/demo database:
npm run smoke:commerce -- --base-url http://127.0.0.1:3100
```

Tests apply actual Alembic migrations to disposable SQLite databases, never runtime
ORM auto-creation. They cover price tampering, snapshots, stock, ownership,
concurrent idempotency and competing sessions. PostgreSQL-compatible schema/SQL
is provided, but PostgreSQL runtime integration has not been executed locally.

GitHub Actions also runs these backend checks on Python 3.12, using the pinned
`requirements-dev.lock` and a fresh SQLite database migrated to head. PostgreSQL
runtime coverage remains a separate follow-up.

Each API test snapshots the migrated, seeded SQLite template with the native backup
API. Copying only the main `.db` file can omit committed schema or rows still in
the WAL and cause intermittent missing-table failures. The source opens read-only,
and both backup connections close explicitly; a missing source fails instead of
creating an empty database. `tests/test_database_snapshot.py` reproduces the
main-file copy failure while committed pages remain in WAL, checks that backups
exclude uncommitted writes, and verifies that changes to one copy leave the
template and other copies intact. Run it with
`python -m pytest -q tests/test_database_snapshot.py` from `backend/`.

## MVP limitations

- Pending orders expire after 30 minutes by default. Release occurs on the next bounded
  sweep or order access; server downtime and sweep backlogs can delay release. Run
  `python -m app.expire_orders` for a manual pass when needed.
- Losing the anonymous cookie loses access to orders; no account recovery or admin UI.
- The original TS display/search/AI catalog remains. Python is authoritative for
  purchasable variants, prices, inventory, carts and orders. Future catalog edits
  need an explicit migration/sync decision; no automatic dual writes are performed.
- Inventory quantities and supplier-derived demo prices are fixtures, not live stock.
- Total is the item subtotal in USD; no shipping, tax, discounts or payment processing.
- SQLite serializes writes; PostgreSQL should be load-tested before multi-instance use.
- No real payment, Shopify sync, external webhook, login, refunds, logistics or queue.
