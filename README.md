# Evoloop — 3D-Printed Casual Shoes

> **目录与 CI 更新（2026-10-02）：** 新增只读 `check:catalog` 门禁，比较 TypeScript 展示快照与 Python commerce 导入快照的稳定商品/变体键、价格、颜色、尺码和无尺码款；不会写入交易数据库。PostgreSQL TLS CI 在切换临时证书后执行完整服务重启，并确认 `ssl_cert_file`、`ssl_key_file` 已生效。当前结果与限制见 [目录漂移报告](./docs/catalog-drift-2026-10-02.md)。

> **Current local integration (2026-10-01):** Commerce/security baseline `4177ec5`, error contracts/tracing `847e32e`, and actual PostgreSQL/TLS acceptance `128a762` are committed locally. AI now conservatively accounts for interrupted provider calls, recovers stale reservations and propagates stream cancellation. Read [AGENTS.md](./AGENTS.md) and the [maintenance docs](./docs/agents/) for the current contract; the [older handover](./docs/archive/HANDOVER.md) is archived and no longer describes the current state. See also the [integration report](./docs/unified-baseline-2026-09-30.md), the [reliability update](./docs/reliability-2026-10-01.md), the [PostgreSQL acceptance report](./docs/postgres-acceptance-2026-10-01.md) and the [budget recovery report](./docs/ai-budget-recovery-2026-10-01.md). Local results do not establish deployment or remote CI success.

**Evoloop** began as a student hackathon project and has grown into an **independent footwear
project**. This repository is its consumer-facing storefront front-end — landing page, `/shop`
browsing, product pages, a Markdown blog and a restrained, consumer-worded shopping assistant —
and the **code is open source (MIT)** with the long-term goal of evolving into a reusable
**open-source shopping landing-site framework**. All supplier-derived demo assets (photos,
catalog data, care poster, demo artwork) stay **All Rights Reserved** — fine to keep and run
in-repo as a demo, but not for redistribution without written authorization (see `LICENSE` +
`LICENSE-ASSETS`). Evoloop claims **no trademark** on its name.

Built with **Next.js (App Router), Tailwind and shadcn/ui on the Node runtime (npm is the package
manager)** — with a server-side shopping assistant that stays understated: consumer wording
only, never "AI"-branded.

The storefront has a **local commerce MVP**: choose a color and size, add the matching Python
variant to the cart, preview server-calculated prices and create a `pending_payment` order.
Orders reserve inventory and support cancellation and expiry. **Real payments are disabled**;
the Mock provider never charges or marks an order paid. Shopify remains a compatibility path
and requires explicit `SHOPIFY_ENABLED=true` plus its credentials; keep it disabled locally.
The display catalog has **29 supplier styles** and real product photos; prices, inventory and
promotional copy are demo data, not verified live offers. Python owns transaction prices and
stock; the TypeScript display/search catalog is a separate data source.

## Tech stack

- **Next.js 16.3.4** (App Router, Turbopack) + React 19 + TypeScript 5
- **npm** as the package manager (the `next` CLI and every gate script run on Node)
- **Tailwind CSS v4** + **shadcn/ui** (Base UI preset)
- **Drizzle ORM**, dual-driver: **SQLite** (`better-sqlite3`, default, zero-setup) or
  **Postgres** (`postgres.js`, Cloud SQL-ready) — chosen by `DB_DRIVER` in the environment
- **Vitest** (unit + React Testing Library), **ESLint**, `tsc --noEmit`
- **Python 3.12+**, FastAPI, Pydantic, SQLAlchemy 2 and Alembic for commerce
- AI: OpenAI-compatible streaming client with a deterministic **Mock mode** when no key is set

## Prerequisites

- **Node ≥ 22** with npm (project ships `packageManager: npm@12.0.1`). Verify with `node --version`.
  Node 20 is **not** supported: `jsdom@30` requires `^22.22.2 || ^24.15.0 || >=26.0.0`, and Node 20
  itself reached EOL on 2026-04-30.
- No API keys are required to run the demo — the AI assistant works in Mock mode.

## Quick start

```bash
npm ci
cp .env.example .env.local      # defaults are fine — empty AI_API_KEY = Mock mode
npm run dev               # http://localhost:3000
```

> **Node runtime throughout.** The `next` CLI and every gate script run on Node; the SQLite driver is
> `better-sqlite3`, which ships **N-API prebuilds** — no compiler or build step required.
> `DB_DRIVER=postgres` (with a `DATABASE_URL=postgres://…`) switches to `postgres.js` —
> both drivers run on Node, Vercel-ready.

The TypeScript display/AI database has five tables: `products`, `product_embeddings`,
`ai_usage`, `ai_budget_days` and `ai_budget_reservations`. Versioned Drizzle migrations
under `drizzle/sqlite` and `drizzle/postgres` initialize them on either driver; the
runtime still applies the migration automatically so local startup remains zero-setup.
The baseline is idempotent for databases created by the former inline DDL and records
applied versions in Drizzle's metadata table. The first daily reservation accounts for
usage already in the legacy ledger. Python commerce uses a **separate database and
explicit Alembic migrations**; application startup never creates its tables.

To generate a new TypeScript migration after changing a schema, update both dialect
schemas and run:

```powershell
npm run db:generate:sqlite
npm run db:generate:postgres
```

Do not mix these files with the Python commerce migrations. Production traces include
the SQL directories through `next.config.ts`; no separate migration command is required
for the local runtime bootstrap.

### Start the local commerce service

Use Python 3.12+ and the pinned backend dependencies; see [backend/README.md](./backend/README.md).
Run these from the repository root. **Only the virtualenv creation line differs by platform**; every
other command is identical on macOS, Linux and Windows because `npm run py` resolves the interpreter
(see [docs/agents/verification.md](./docs/agents/verification.md)).

```bash
python3.12 -m venv backend/.venv        # Windows: py -3.12 -m venv backend/.venv
cp backend/.env.example backend/.env    # only if backend/.env does not exist yet
npm run py -- -m pip install -r requirements-dev.lock
npm run db:migrate:python
npm run py -- -m app.seed
npm run py -- -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The Python service defaults to `APP_ENV=development` for local SQLite. Production
must set `APP_ENV=production` and use a PostgreSQL URL with
`sslmode=verify-full`; the service rejects SQLite and weaker PostgreSQL modes before
creating an engine. See [the Python PostgreSQL TLS boundary report](./docs/python-postgres-tls-2026-10-03.md).

In a second terminal at the repository root, keep `SHOPIFY_ENABLED=false`, set
`PYTHON_API_URL=http://127.0.0.1:8000` and `AI_DISABLE_REAL=1`, then run `npm run dev`.
Open `/product/dc-1001`, choose a color/size, add to `/cart`, change quantity, create an
order at `/checkout`, and cancel it from `/orders/<id>`. Payment remains unavailable.
Existing environment files must not be overwritten. Stop on any install/migration failure.

For isolated alternate ports, the HTTP check accepts
`npm run smoke:commerce -- --base-url http://127.0.0.1:3100`.
It creates and cancels demo orders; run only against a disposable/demo database.

**Catalog lives in the `products` table.** The catalog adapter defaults to reading the table;
when it is empty the first request auto-seeds it from the import layer (supplier JSON +
curation). `CATALOG_SOURCE=seed` switches back to the pure in-memory import layer (used by unit
tests); the reserved Shopify adapter takes priority only with `SHOPIFY_ENABLED=true` and both catalog credentials.

### What you can do without any setup

- Landing page, `/shop` (URL-driven filters), product detail pages (SSG, 29 products)
- Wishlist (localStorage), size picker with market conversion (US system by default)
- Floating assistant (right-bottom "Need a hand?" FAB on non-landing pages):
  chips `Find my size` / `Style it with` / `Help me pick` / `Everyday sneakers`,
  streamed answers, product result cards, deterministic size recommendation — all in Mock mode.
- PDP → "Find my size" opens the assistant pre-seeded with the current shoe.

## Scripts

| Command | Meaning |
|---|---|
| `npm run dev` | Next dev server (Turbopack) on the **Node** runtime. |
| `npm run build` | Production build (Node runtime). |
| `npm run start` | Serve the production build (Node runtime). |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check:boundary` | Guards that `'use client'` modules carry no runtime `@/server/**` import. |
| `npm run check:coupling` | Checks runtime import cycles, transitive client/domain boundaries and guardrails' budget port. |
| `npm run check:catalog` | Read-only comparison of display/commerce snapshots and stable variant keys; set `CATALOG_DRIFT_DATABASE` for an optional local runtime DB check. |
| `npm run check:slop` | Zero-dependency mechanical slop scan: unreachable files/exports/statements and stray-focus tests fail the gate; commented-out code, markers and conditional skips are reported for human judgement. Covers only what is mechanically decidable. |
| `npm run check:slop:python` | Same scan for `backend/`, via the resolved Python interpreter; run `--self-test` to exercise its built-in false-positive regressions. |
| `npm run lint` | ESLint over the repo |
| `npm run test` | Vitest unit and integration tests on Node; see the dated integration report for actual counts. |
| `npm run verify` | One-shot acceptance gate: formatting, typecheck, boundaries, coupling, catalog drift, mechanical slop scan, lint and tests. |
| `npm run test:watch` | Vitest watch mode |
| `npm run preflight` | Deployment-before environment gate: `npm run preflight -- --environment production`. Refuses insecure production settings and never prints secret values. |
| `npm run py -- …` | Any Python command; resolves the `backend/.venv` interpreter on every platform. |
| `npm run verify:python` | Python gate: ruff format, ruff check, mypy, compileall, alembic check, slop scan, pytest. |
| `npm run verify:all` | `verify` followed by `verify:python`. |
| `npm run test:python` | `pytest -q` inside `backend/`. |
| `npm run db:migrate:python` | `alembic upgrade head` inside `backend/`. |
| `npm run smoke:commerce` | Live HTTP commerce smoke test; needs both services running and a disposable database. |

The acceptance gate is **format:check + typecheck + check:boundary + check:coupling + check:catalog + check:slop + lint + test** (`npm run verify`),
with **`npm run build`** run separately. CI is configured for Node 22 / 24 and Python 3.12;
local results do not establish the current remote CI or deployment state.

### Isolated PostgreSQL acceptance

Set `AI_TEST_POSTGRES_URL` only in a test process, pointing to a dedicated loopback
database whose name ends in `_test`. Run
`npm test -- src/server/search/repository-postgres.integration.test.ts`. The suite owns
and removes one random schema, warms independent connections and verifies competing
reservations, duplicate retries and rollback. Without the variable it is explicitly skipped.

For TypeScript schema migration startup locking, set
`AI_TEST_POSTGRES_MIGRATIONS_URL` to a separate disposable loopback database whose name
ends in `_test`, then run
`npm test -- src/db/postgres-migrations.integration.test.ts`. The test opens two independent
`max=1` clients, starts both migrations together, and verifies that exactly one migration
marker is written. Without the variable it is explicitly skipped; never point it at a
commerce or production database.

For TLS, use a disposable server configured with the public localhost-only fixture in
`src/test/fixtures/postgres-tls.json`, set `AI_TEST_POSTGRES_TLS_URL` with hostname `localhost`,
then run `npm test -- src/db/postgres-tls.integration.test.ts`. It executes a real encrypted
query and rejects untrusted certificates and mismatched hostnames. These test keys must
never be used for production. The PostgreSQL CI job prepares its own disposable server.
See the acceptance report for local evidence and the separate Python test command.

## Environment variables

See [`.env.example`](.env.example) for the annotated template. Summary:

| Variable | Default | Meaning |
|---|---|---|
| `SITE_MARKET` | `US` | Market (`US\|EU\|UK\|JP\|CN`); drives the size-display system + mm-anchored conversions |
| `AI_API_KEY` | *(empty)* | **Empty → Mock mode** (zero cost, demoable). Set to enable the real OpenAI-compatible provider. |
| `AI_BASE_URL` | *(empty)* | OpenAI-compatible endpoint base URL (empty = official OpenAI) |
| `AI_MODEL` | `gpt-5.6-luna` | Chat model for the real provider (2026-09: GPT-5.6 budget tier; quality-upgrade: `gpt-5.6-terra`) |
| `AI_INCLUDE_USAGE` | `1` | Requests final streaming usage for exact settlement; set `0` only for gateways that reject `stream_options` (estimate fallback). |
| `AI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model for semantic search (cached locally) |
| `AI_MAX_TURNS` | `20` (max `100`) | Per-session turn cap (soft message when exceeded) |
| `AI_MAX_OUTPUT_TOKENS` | `500` (max `2000`) | Max output tokens per provider response |
| `AI_REQUEST_TIMEOUT_MS` | `20000` (max `120000`) | Chat streaming and embedding fetch/body timeout; probe capped at 3000 ms |
| `AI_MAX_MESSAGE_CHARS` | `800` (max `4000`) | Max characters per incoming user message |
| `AI_DAILY_TOKEN_CAP` | `1000000` (max `10000000`) | UTC estimated-token budget; atomic admission, completed usage settlement and conservative accounting for uncertain calls |
| `AI_SESSION_SECRET` | *(required in production)* | Private signing secret, at least 32 bytes; missing/short configuration fails closed |
| `TRUSTED_PROXY_IPS` | *(empty)* | Exact trusted immediate peer IPs; XFF is ignored without a verified peer |
| `AI_DISABLE_REAL` | `0` | `1` forces Mock mode even with a key (abuse kill switch) |
| `DB_DRIVER` | `sqlite` | `sqlite` (default) or `postgres` — selects the app DB driver |
| `CATALOG_SOURCE` | `db` | Runtime catalog source: `db` = `products` table (default, auto-seeded when empty); `seed` = in-memory import layer (tests); explicitly enabled Shopify configuration takes priority |
| `DATABASE_URL` | `./data/local.db` | sqlite: local file; postgres: `postgres://…` connection string |
| `PG_SSL` | *(verified TLS in production)* | `1`/`verify-full` verifies certificates; plaintext `0` is development-only |
| `PG_SSL_CA_FILE` | *(system roots)* | Optional readable PEM CA bundle, never committed |
| `NODE_TLS_REJECT_UNAUTHORIZED` | *(unset)* | `0` is rejected in production before a PostgreSQL client is created; do not use it as a TLS workaround |
| `PYTHON_API_URL` | `http://127.0.0.1:8000` | Server-only commerce endpoint; not exposed to browser JavaScript |
| `COMMERCE_PROXY_SECRET` | *(empty for local demo)* | Shared server-only credential for Next → Python; production requires at least 32 random bytes |
| `SHOPIFY_ENABLED` | `false` | Explicit compatibility purchase switch; keep disabled for the local MVP |
| `SHOPIFY_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN` | *(empty)* | Reserved catalog stub; selected only with both credentials and `SHOPIFY_ENABLED=true`. It is not a working sync integration. |
| `SHOPIFY_BUY_DOMAIN`, `SHOPIFY_BUY_TOKEN` | *(empty)* | Compatibility Buy Button credentials, independent of catalog credentials. Requires both plus `SHOPIFY_ENABLED=true`; disabled by default so PDPs use Python variants and cart. The external store was not tested in this integration. |

Before a production build is started, set `APP_ENV=production` and run
`npm run preflight -- --environment production` (the legacy PowerShell spelling
`-Environment production` still works). The explicit environment value is
required so a production build cannot silently inherit the local development mode.
The preflight checks the deployment boundary without printing secrets: PostgreSQL is selected,
TLS verification is enabled, the AI session secret is long enough, Python is not
exposed as a loopback production URL, the Next → Python proxy secret is long enough,
and the unsupported Shopify purchase path is disabled. Development defaults remain
compatible with the local SQLite/Mock setup.
The AI Route Handler also rejects bodies above 16 KiB and invalid fields before
creating a session or reserving budget; its `X-Request-ID` is server-owned correlation
data, not a session or idempotency credential. See the [AI request boundary report](./docs/ai-request-boundary-2026-10-03.md).

### Enabling real AI

1. Put a real key in `AI_API_KEY` (optionally `AI_BASE_URL` for a gateway / custom endpoint).
2. Set `AI_EMBEDDING_MODEL` + `AI_BASE_URL` to activate semantic retrieval; without them the
   assistant transparently uses keyword search over the catalog.
3. Restart. Guardrails (rate limit, turn cap, daily budget) apply to real and Mock alike.
   `AI_DISABLE_REAL=1` is the one-switch rollback to Mock: it blocks new real chat and
   embedding calls (including capability probes and cached capability results), while
   local keyword recommendations remain available. Set it in the server environment
   and restart; changing an environment file alone does not update a running process.
   It does not cancel requests already dispatched or erase recorded usage.

Each provider attempt and each embedding network call owns a separate budget reservation. SDK automatic retries are disabled,
and upstream SDK logs are suppressed so private response content cannot bypass the
application's safe error logging. When the provider returns a valid final usage chunk,
prompt and completion tokens are settled from that response. Missing or invalid usage
falls back to the character estimate; `AI_INCLUDE_USAGE=0` selects that fallback explicitly
for incompatible gateways. This is an accounting input, not a provider billing guarantee.
Completed usage above the admission estimate is recorded even if it exceeds the configured cap;
subsequent reservations are rejected. See the [usage accuracy report](./docs/ai-usage-accuracy-2026-10-02.md).

Once provider work starts, failure, timeout or cancellation marks its reservation
`abandoned` and consumes the full reserved estimate. This can overcount unbilled failures,
but prevents uncertain work from receiving a refund. These amounts are audit estimates,
not fake completed replies in `ai_usage`. Before-provider failures may release their budget.
Reservation attempts recover at most 100 stale pending rows per minute per instance,
after at least five minutes (or `3*AI_REQUEST_TIMEOUT_MS+60000`, whichever is greater).
Recovery preserves accounting and uses an indexed scan; idle applications recover on
their next reservation attempt. A recovery database failure stops admission and is retried
on the next attempt. See the budget report for rollback and remaining production limits.

### Switching market / sizes

`SITE_MARKET` is a **deployment-level, single-market** setting (no runtime market switching):
sizes are stored once in a canonical EU system and converted to the market's system
(US/EU/UK/JP/CN, foot-length-mm anchored) for display, filtering and "Find my size". Currency and
copy stay English/USD.

## Directory map

```
src/
  app/                     # App Router pages & routes
    page.tsx               # Landing (zero AI presence by design)
    shop/page.tsx          # /shop — SSR list, URL-state filters (collection/size/price/sort/q)
    product/[handle]/page.tsx  # PDP — SSG shell plus Python variant/cart controls
    api/ai/chat/route.ts   # POST SSE endpoint (delta|productCards|sizeFit|done|error frames)
    og/route.tsx           # Local OpenGraph image (ImageResponse, no network)
  components/
    marketing/             # AppBar, Footer, Hero, CollectionCards, Story, ...
    shop/                  # ProductCard/Grid, ProductVisual (SVG), size selector, wishlist, PDP cluster
    assistant/             # FAB + Sheet chat panel, SSE hook, chips, message list
    ui/                    # shadcn/ui primitives
  server/                  # Server-only layers (never imported by client code except `type`)
    catalog/               # Seed/DB adapter + market-aware service + Shopify Buy map (handle → store id)
    search/                # embedder, keyword search, retrieval (embedding cache + cosine), vector
    ai/                    # providers (Mock/OpenAI-compatible), chat orchestration, SSE events, prompts
    guardrails/            # rate limit, session state (turns/TTL/trim), token budget, soft copy
  db/                      # Drizzle dual-driver schemas (5 tables each: sqlite-core + pg-core), clients, product-row codec
  lib/                     # shared pure helpers (site, market, wishlist, size charts, formats, SEO)
  test/                    # test scaffolding (vitest setup + a11y axe gate)
```

## Architecture notes

- **Catalog**: runtime source is the `products` DB table — auto-seeded from the import layer
  (29 supplier styles across 4 collections, curation in `seed.ts` over `data/supplier.json`)
  when empty; `/shop`, PDP and search all read the table, so edits (title, price, collection…)
  apply on the next dynamic request. `CATALOG_SOURCE=seed` keeps the pure in-memory layer for
  tests. Product cards and PDP galleries use real photos (`Product.images`, WebP under
  `public/products/<handle>/`) and fall back to SVG visuals only when image-less. A separate
  `gifts.ts` module feeds the `/shop` free-gift gallery (gifts are display-only, never in the
  sellable catalog).
- **Store buy channel** (2026-09): the repository retains mappings for 29 Shopify product
  handles; current external store state is unverified. `src/server/catalog/shopify-buy.ts` is a **low-coupling static map** (local
  `handle` → store numeric id, no Product/DB/schema changes) read by the PDP page; when
  `SHOPIFY_BUY_DOMAIN` + `SHOPIFY_BUY_TOKEN` are set, the store-mapped PDP hides the demo
  price/pickers and mounts one parameterized `ShopifyBuyButton` (SDK `createComponent` loading
  the admin-generated options verbatim), letting the store own variants, price and checkout.
  Both credentials also require `SHOPIFY_ENABLED=true`. Otherwise PDPs use the Python
  variant/cart flow. No QR image or client action enables real payment.
- **AI**: RAG-lite, zero tool-calling — every real/gateway model only needs chat completions.
  Retrieved product cards are injected into the system prompt; the model must answer from that
  injected content only. Modes: `shopping`, `size-fit` (deterministic), `outfit`, `find-shoes`,
  and `support` (store-policy Q&A from the shared `src/lib/store-policy` facts).
- **Guardrails**: signed, expiring HttpOnly AI cookies; IP/session rate limits; bounded
  stores with periodic TTL cleanup; history trimming; output caps and provider timeouts.
  Atomic daily budget counters are persisted in the database. IP/turn/history limits
  remain process-local: **deploy only one instance until shared state is designed and tested**.
  Without a trusted immediate peer, all anonymous requests share a conservative IP bucket.
- **Search**: embedding vectors cached in `product_embeddings` (contentHash-validated), keyed by
  `Product.id` (unchanged by the DB move), cosine in
  app code (fine below ~2k products — beyond that, move to a native vector backend).

## Known limitations

- The cart and pending-order workflow is a local MVP. It has no real payment, login recovery,
  shipping, tax, refunds or automatic catalog synchronization. Cookie loss loses access to
  anonymous orders. Python must remain internal; a UUID bearer credential is not public API authentication.
- Unknown product handles return the not-found UI with **HTTP 200 + `noindex`** under the current
  `dynamicParams` SSG setting (a deliberate, documented tradeoff; revisit if SEO on 404s matters).
- Essential anonymous AI and commerce cookies are used. AI token usage is estimated rather
  than provider billing data. Process crashes may leave pending reservations; reconciliation
  and real PostgreSQL runtime/load tests remain production follow-ups.

## Disclaimer

Independent project (born at a hackathon); the order flow, pricing and copy are demo. Supplier
product codes, photos, colors and size segments are real (from the brand supply-chain workbook);
English marketing names, prices and copy are demo placeholders, as is the size conversion table
(foot-length-mm anchored, canonical EU 35–48). The free-gift offer is a demo promotion. No real
purchase flow is connected.

## License

Source code is released under the **MIT License** (see `LICENSE`). All resource / demo assets
(supplier photos under `public/products/`, the supplier catalog import under
`src/server/catalog/data/`, hero image & care poster under `src/assets/`, blog posts under
`content/blog/`, demo artwork under `public/`) are **All Rights Reserved** and may not be
redistributed without written authorization (see `LICENSE-ASSETS`).
