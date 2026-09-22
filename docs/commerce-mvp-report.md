# Commerce MVP implementation — 2026-09-21

## Baseline

- Read AGENTS.md, README.md, CONTEXT.md, the historical implementation report, product
  domain, adapter contract, Drizzle schema, catalog route and AI route before editing.
- Read the installed Next.js 16 Route Handler, fetching, caching and environment guides.
- `npm test`: sandbox initially blocked worker creation (`spawn EPERM`); normal-permission
  rerun passed **64 files / 389 tests**.
- `npm run lint`: passed.
- `npm run build`: failed because all three existing Google Fonts could not be downloaded,
  including after a normal-permission rerun. Fixed only this blocking baseline issue by
  bundling the same font families using Fontsource packages. Layout/design is retained.

## Delivered

Python backend in `backend/`, with explicit Alembic migration for 13 tables, repeatable
catalog import, stable persisted variant UUIDs, Decimal calculations, atomic inventory
reservations, snapshot order lines, anonymous ownership, idempotent orders and cancellation,
transactional audits and disabled-only MockPaymentProvider. The webhook table is dormant.

Next.js retains its existing catalog/search/AI services. `/api/commerce/[...path]` proxies
only approved business routes, maps the HttpOnly session cookie to the Python credential,
checks origin, disables caching and reports backend outages. Product actions resolve color
name + canonical size against backend variants and submit only variant ID + quantity.
The existing color-array index remains solely a gallery presentation coordinate; it is
never a purchasable variant identifier. `/cart`, `/checkout`, `/orders/[id]` provide the flow.
Shopify requires explicit `SHOPIFY_ENABLED=true` in addition to legacy credentials; defaults
are off and the MVP never enables it. The old demo QR payment dialog is replaced.

## Verification

- Python API/transaction tests: **16 passed**, including concurrent requests,
  rollback after reservation and strict quantity validation.
- Ruff lint and formatting, mypy (16 application modules), Alembic schema drift check: passed.
- `python -m compileall backend`: executed with the project Python 3.12 runtime.
- Next.js tests: **66 files / 395 tests** passed in the final run.
- Next.js lint, typecheck, server boundary and production build: passed; **44 static pages**.
- Browser integration found a real `127.0.0.1` vs normalized `localhost` origin mismatch.
  Fixed by checking the actual request Host, with an additional regression test.

Final `npm run format:check` and full `python -m compileall backend` both passed
with exit 0. Windows sandbox cache-directory restrictions required normal-permission
verification runs; no application workaround was needed. PostgreSQL offline migration
SQL generation passed (13 business tables plus Alembic's version table). Runtime
PostgreSQL integration remains unverified.

Real-browser acceptance passed on the production build: selected Ivory / US 8.5
(canonical EU 42), verified the corresponding image, added to cart, changed quantity
to 2, observed USD 118.00, created an order showing `pending_payment` and
“支付暂未开放”, reopened the persisted order URL, and cancelled it. The catalog API
showed available inventory changing **10 → 8 → 10**. Test order ID:
`51b836ee-369d-463d-8629-e406eddbc060` (cancelled; no charge).

`backend/.venv/Scripts/python.exe scripts/smoke-commerce.py` also passed against
both running services: existing page routes, proxy session, cart mutation, forged-price
rejection by repricing, preview, order idempotency, disabled Mock payment, cancellation,
and stock restoration. Smoke orders remain cancelled in the local demo DB with audits.

## Core files

- `backend/app/domain/models.py`: persistence constraints and money/snapshot fields.
- `backend/app/application/commerce.py`: cart locking, order/reservation transactions, Mock payment.
- `backend/app/api/v1/routes.py`: all requested versioned APIs.
- `backend/migrations/versions/41e28c896353_initial_commerce.py`: explicit database schema.
- `backend/app/seed.py`, `backend/data/catalog.json`: repeatable local catalog bootstrap.
- `backend/tests/`: actual migration-backed tests, including concurrency.
- `src/app/api/commerce/[...path]/route.ts`: transitional secure session proxy.
- `src/components/shop/product-actions.tsx`, `product-buy-bar.tsx`: real variant and cart flow.
- `src/components/shop/commerce-panel.tsx`: cart, checkout and order UI.
- `src/app/cart/`, `checkout/`, `orders/`: new routes using the existing site shell.
- `src/server/catalog/shopify-buy.ts`, `shopify-stub.ts`: explicit off-by-default compatibility.
- `src/app/layout.tsx`, `globals.css`, package manifests: offline fonts for reproducible builds.

## Remaining scope / risks

No real payment or paid state, login, Shopify sync, Redis, queues, discounts, refunds,
shipping integration, full administration or AI migration. No external provider is contacted
by commerce. PostgreSQL DDL compatibility is checked separately; PostgreSQL runtime and
load testing remain pending. The original MVP required manual cancellation to release stock;
the reservation-expiry follow-up below adds automatic release. Downtime or a sweep backlog
can still delay release. Cookie loss prevents access; anonymous IDs are bearer secrets.
TS display/search catalog and Python commerce catalog can diverge after future edits until a
deliberate next migration. Catalog seed stock is demo stock (10 per variant), not supplier stock.

The current FastAPI/Starlette TestClient emits upstream httpx/anyio deprecation warnings;
the requested httpx tests pass. No runtime workaround or alternate technology was introduced.
The initial implementation was delivered without a Git commit. The user subsequently
authorized committing it. Local `.env.local` selects the Python API at
`http://127.0.0.1:8000` and keeps Shopify disabled; `backend/.env` selects local SQLite.
These local settings, databases, virtual environments and verification logs are ignored
by Git and are not part of the source commit.

## Follow-up branch: reservation expiry

The next feature branch is `codex/expire-inventory-reservations`. It adds `expires_at` and
`cancellation_reason` through Alembic, a 30-minute default reservation TTL, an in-process
bounded sweeper plus `python -m app.expire_orders`, due-date checks on order/payment/cancel
requests, and UI refresh/deadline copy. The same transaction releases inventory and writes
audits. It does not introduce Redis, Celery or a paid provider. Its test suite covers 30 Python
cases, including migration preservation, concurrent workers, rollback, batch catch-up,
transient worker recovery and historical order snapshots.


## Follow-up verification — 2026-09-22

The `verify` workflow now includes a Python 3.12 job alongside Node 22/24. It installs
`backend/requirements-dev.lock`, runs Ruff lint/format and mypy, migrates a fresh SQLite
database to head, checks schema drift, runs pytest and compiles application/migration/test
modules. Actions are pinned to commit SHAs. This job does not claim PostgreSQL runtime coverage.

Local verification after this addition: 30 Python tests passed (two upstream deprecation
warnings), Ruff lint/format passed (25 files), mypy passed (18 source files), fresh Alembic
upgrade and drift checks passed, and `python -m compileall -q backend` passed from the
repository root. Workflow Prettier and `git diff --check` passed. No frontend application code
changed in this CI/documentation follow-up; the preceding reservation-expiry verification
passed 397 tests in 66 files, lint, typecheck, boundary checks and a 44-page production build.

PR #6 remains a draft dependent on the unmerged MVP PR #5. Once that dependency is merged,
replay only the follow-up changes onto the resulting main and revalidate. The earlier Node
22/24 GitHub jobs passed; the Vercel preview requires deployment authorization from the
upstream team. Neither default branch nor deployment permissions were changed.
