# Evoloop — 3D-Printed Casual Shoes

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

The storefront now includes a **local commerce MVP**: select a backend variant → cart →
server-recomputed checkout → inventory reservation → `pending_payment` order. The UI clearly
shows **“支付暂未开放”**. No real payment or paid state exists. Shopify compatibility is
retained but **off by default** (`SHOPIFY_ENABLED=false`). The original TypeScript display,
search and AI services remain during the gradual migration.

The independent Python 3.12+ backend owns variants, prices, inventory, carts and orders.
See [backend setup and API documentation](backend/README.md) and the
[verified MVP report](docs/commerce-mvp-report.md). Existing supplier assets remain restricted
by LICENSE-ASSETS.

## Tech stack

- **Next.js 16.3.4** (App Router, Turbopack) + React 19 + TypeScript 5
- **npm** as the package manager (the `next` CLI and every gate script run on Node)
- **Tailwind CSS v4** + **shadcn/ui** (Base UI preset)
- **Drizzle ORM**, dual-driver: **SQLite** (`better-sqlite3`, default, zero-setup) or
  **Postgres** (`postgres.js`, Cloud SQL-ready) — chosen by `DB_DRIVER` in the environment
- **Vitest** (unit + React Testing Library), **ESLint**, `tsc --noEmit`
- AI: OpenAI-compatible streaming client with a deterministic **Mock mode** when no key is set

## Prerequisites

- **Node ≥ 22** with npm (project ships `packageManager: npm@12.0.1`). Verify with `node --version`.
  Node 20 is **not** supported: `jsdom@30` requires `^22.22.2 || ^24.15.0 || >=26.0.0`, and Node 20
  itself reached EOL on 2026-04-30.
- No API keys are required to run the demo — the AI assistant works in Mock mode.

## Quick start

This starts the retained browsing/AI frontend. For the complete commerce flow, start
both services using the commands below.

```bash
npm ci
cp .env.example .env.local      # defaults are fine — empty AI_API_KEY = Mock mode
npm run dev               # http://localhost:3000
```

> **Node runtime throughout.** The `next` CLI and every gate script run on Node; the SQLite driver is
> `better-sqlite3`, which ships **N-API prebuilds** — no compiler or build step required.
> `DB_DRIVER=postgres` (with a `DATABASE_URL=postgres://…`) switches to `postgres.js` —
> both drivers run on Node, Vercel-ready.

The **legacy TypeScript display/AI database** auto-creates its schema (**three** tables: `products` + `product_embeddings`,
`ai_usage`) via idempotent `CREATE TABLE IF NOT EXISTS` on **either** driver — SQLite file at
`./data/local.db`, or the Postgres database behind `DATABASE_URL`. This legacy behavior is retained. The new Python commerce database is separate and requires **Alembic migrations**; it never auto-creates tables at runtime.

**Catalog lives in the `products` table.** The catalog adapter defaults to reading the table;
when it is empty the first request auto-seeds it from the import layer (supplier JSON +
curation). `CATALOG_SOURCE=seed` switches back to the pure in-memory import layer (used by unit
tests); `SHOPIFY_ENABLED=true` plus credentials is required for the dormant Shopify adapter.

### Start both services (PowerShell)

```powershell
# Terminal 1: first setup + backend
python3.12 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.lock
Copy-Item backend/.env.example backend/.env
cd backend
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m app.seed
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2: repository root
npm ci
# Add to .env.local (preserve any existing configuration):
# PYTHON_API_URL=http://127.0.0.1:8000
# SHOPIFY_ENABLED=false
npm run dev
```

Open `/shop`, choose a color and size on a product, use **加入购物车**, then `/cart`
and `/checkout`. Order creation reserves inventory and shows its ID plus **支付暂未开放**.
The order link supports reload and cancellation (releases stock). Local use needs no API keys.

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
| `npm run lint` | ESLint over the repo |
| `npm run test` | Vitest (63 files, 375 tests) on Node via the `better-sqlite3` driver. |
| `npm run verify` | One-shot acceptance gate: `format:check` + `typecheck` + `check:boundary` + `lint` + `test`. |
| `npm run test:watch` | Vitest watch mode |

The acceptance gate is **format:check + typecheck + check:boundary + lint + test** (`npm run verify`),
with **`npm run build`** run alongside it — all green on `main` (HEAD), and verified across
**Node 22 / 24** in CI.

## Environment variables

See [`.env.example`](.env.example) for the annotated template. Summary:

| Variable | Default | Meaning |
|---|---|---|
| `SITE_MARKET` | `US` | Market (`US\|EU\|UK\|JP\|CN`); drives the size-display system + mm-anchored conversions |
| `AI_API_KEY` | *(empty)* | **Empty → Mock mode** (zero cost, demoable). Set to enable the real OpenAI-compatible provider. |
| `AI_BASE_URL` | *(empty)* | OpenAI-compatible endpoint base URL (empty = official OpenAI) |
| `AI_MODEL` | `gpt-5.6-luna` | Chat model for the real provider (2026-09: GPT-5.6 budget tier; quality-upgrade: `gpt-5.6-terra`) |
| `AI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model for semantic search (cached locally) |
| `AI_MAX_TURNS` | `20` | Per-session turn cap (soft message when exceeded) |
| `AI_MAX_OUTPUT_TOKENS` | `500` | Max output tokens per provider response |
| `AI_REQUEST_TIMEOUT_MS` | `20000` | Provider request timeout |
| `AI_MAX_MESSAGE_CHARS` | `800` | Max characters per incoming user message |
| `AI_DAILY_TOKEN_CAP` | `1000000` | Daily token budget (SUM over `ai_usage` per UTC day) |
| `AI_DISABLE_REAL` | `0` | `1` forces Mock mode even with a key (abuse kill switch) |
| `DB_DRIVER` | `sqlite` | `sqlite` (default) or `postgres` — selects the app DB driver |
| `CATALOG_SOURCE` | `db` | Runtime catalog source: `db` = `products` table (default, auto-seeded when empty); `seed` = in-memory import layer (tests); Shopify requires explicit `SHOPIFY_ENABLED=true` |
| `DATABASE_URL` | `./data/local.db` | sqlite: local file; postgres: `postgres://…` connection string |
| `SHOPIFY_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN` | *(empty)* | Reserved. Catalog adapter switches to Shopify only when `SHOPIFY_ENABLED=true` and **both** are set (not yet active). |
| `SHOPIFY_BUY_DOMAIN`, `SHOPIFY_BUY_TOKEN` | *(empty)* | **PDP Shopify Buy Button channel** (2026-09): only with `SHOPIFY_ENABLED=true` and **both** credentials set, every PDP mapped in `src/server/catalog/shopify-buy.ts` (29/29 store products, handle-keyed) renders a real Buy Button that takes over variant selection + checkout; unset keeps the local commerce flow. Independent of the two vars above on purpose (setting those would trip the catalog stub). |

### Enabling real AI

1. Put a real key in `AI_API_KEY` (optionally `AI_BASE_URL` for a gateway / custom endpoint).
2. Set `AI_EMBEDDING_MODEL` + `AI_BASE_URL` to activate semantic retrieval; without them the
   assistant transparently uses keyword search over the catalog.
3. Restart. Guardrails (rate limit, turn cap, daily budget) apply to real and Mock alike.
   `AI_DISABLE_REAL=1` is the one-switch rollback to Mock.

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
    product/[handle]/page.tsx  # PDP — SSG (generateStaticParams), variant/cart flow
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
  db/                      # Drizzle dual-driver schemas (3 tables each: sqlite-core + pg-core), clients, product-row codec
  lib/                     # shared pure helpers (site, market, wishlist, size charts, formats, SEO)
  test/                    # test scaffolding (vitest setup + a11y axe gate)
```

## Architecture notes

- **Catalog**: runtime source is the `products` DB table — auto-seeded from the import layer
  (29 supplier styles across 4 collections, curation in `seed.ts` over `data/supplier.json`)
  when empty; `/shop`, PDP and search all read the table, so edits (title, price, collection…)
  apply on the next dynamic request for the retained display/search layer. `CATALOG_SOURCE=seed` keeps the pure in-memory layer for
  tests. Product cards and PDP galleries use real photos (`Product.images`, WebP under
  `public/products/<handle>/`) and fall back to SVG visuals only when image-less. A separate
  `gifts.ts` module feeds the `/shop` free-gift gallery (gifts are display-only, never in the
  sellable catalog).
- **Store buy channel** (2026-09): the linked Shopify store holds the same 29 products under
  matching handles. `src/server/catalog/shopify-buy.ts` is a **low-coupling static map** (local
  `handle` → store numeric id, no Product/DB/schema changes) read by the PDP page; when
  `SHOPIFY_BUY_DOMAIN` + `SHOPIFY_BUY_TOKEN` are set, the store-mapped PDP hides the demo
  price/pickers and mounts one parameterized `ShopifyBuyButton` (SDK `createComponent` loading
  the admin-generated options verbatim), letting the store own variants, price and checkout.
  Disabled by default → PDP variant selection and cart use the Python commerce proxy; no QR
  payment dialog or real payment is available. Both Shopify paths require `SHOPIFY_ENABLED=true`.
- **AI**: RAG-lite, zero tool-calling — every real/gateway model only needs chat completions.
  Retrieved product cards are injected into the system prompt; the model must answer from that
  injected content only. Modes: `shopping`, `size-fit` (deterministic), `outfit`, `find-shoes`,
  and `support` (store-policy Q&A from the shared `src/lib/store-policy` facts).
- **Guardrails** (all anonymous, no PII): in-memory token bucket rate limit (IP + session),
  per-session turn cap + history trim + idle TTL, output-token cap + timeout, and a **persisted**
  daily token budget on `ai_usage`. Soft copy everywhere ("taking a short break"), never
  "rate limited". Runs entirely in-process (single-instance assumption — adequate for this demo
  deployment; revisit before multi-instance hosting).
- **Search**: embedding vectors cached in `product_embeddings` (contentHash-validated), keyed by
  `Product.id` (unchanged by the DB move), cosine in
  app code (fine below ~2k products — beyond that, move to a native vector backend).

## Known limitations

- Payment is disabled. Pending orders reserve inventory until explicitly cancelled; no automatic
  expiration job exists. Losing the anonymous session cookie loses access to its orders.
- The TypeScript display/search catalog and Python commerce catalog start from the same snapshot;
  future edits need a deliberate migration/sync step. Python always re-reads prices at checkout.
- PostgreSQL-compatible schema and SQL are provided; local runtime tests use SQLite.
- Unknown product handles return the not-found UI with **HTTP 200 + `noindex`** under the current
  `dynamicParams` SSG setting (a deliberate, documented tradeoff; revisit if SEO on 404s matters).
- Privacy: an essential HttpOnly anonymous cart cookie is used; no tracking. Anonymous `ai_usage`
  token counts are stored locally for budget enforcement only.

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
