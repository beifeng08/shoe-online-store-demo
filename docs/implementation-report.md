> Current commerce implementation (2026-09-21): see [commerce-mvp-report.md](commerce-mvp-report.md). This file remains a historical report.

# Implementation Report — Evoloop 3D-Printed Shoe Storefront (feat/shoe-store)

> **时效标注（2026-09-15 追加）：** 本报告是 HEAD `83fd694` 的**历史快照**，以下三处已与当前 HEAD 不符。
> 保留原文不改写，以维持它作为历史记录的价值：
>
> - 「DB: SQLite via `bun:sqlite`」→ 现为 `better-sqlite3`（以 `src/db/client.ts` 为准）
> - 「scripts bake in `bun --bun`」→ `dev` / `build` / `start` 已去掉 `--bun`，一律由 Node 执行
> - `bun --bun run build`（本文的 gate 命令）→ `bun run build`；`--bun` 会让 Bun SIGILL 崩溃
>
> 运行时已无任何 Bun 专有 API。包管理器/锁文件层已在批次 7 迁至 npm：
> `bun.lock` → `package-lock.json`，`packageManager: npm@12.0.1`，本文中的 `bun install` /
> `bun run x` 一律读作 `npm ci` / `npm run x`。迁移的范围与放弃标准见
> [`adr/0006-bun-to-node-scope.md`](./adr/0006-bun-to-node-scope.md)。
> 领域词汇见 [`../CONTEXT.md`](../CONTEXT.md)，架构决策见 [`adr/`](./adr/)。

Status: **all 18 plan tasks implemented and reviewed; acceptance gates green at HEAD `83fd694`; a pre-merge hardening commit follows (scripts bake in `bun --bun`, ai_usage model attribution single-source, retrieval relevance floor, SVG pattern-id instance salt, buyUrl test assertion, doc quirks — see G2/G4/G5/G7 and "documented quirks" below).**
Branch: `feat/shoe-store` (isolated worktree under `.worktrees/shoe-store`). Base `4cc9494`.

## 1. What was built (做了什么)

A consumer-facing Next.js 16 (App Router) storefront demo for the fictional brand "Evoloop",
selling 3D-printed casual shoes, with a deliberately subtle server-side AI shopping guide
(spec principle P1: consumer wording only — "Need a hand?" / "Find my size" / "Style it with";
the word "AI" never appears in UI copy; the Landing page has zero AI presence).

- **Pages**: Landing `/` · `/shop` (SSR, URL-state filters collection/size/price/sort/query) ·
  `/product/[handle]` (SSG × 16, not-found/loading/error shells, local `/og` OpenGraph image,
  page metadata with brand template). Detail CTA is an "Available soon" placeholder whose
  enabled state is driven by a `getBuyUrl` catalog-adapter contract (`null` until Shopify exists).
- **Catalog**: seed adapter — 16 3D-printed casual shoes across Everyday/Comfort/Travel/Minimal,
  sizes stored canonically (EU 36–48) with foot-length-mm-anchored US/EU/UK/JP/CN conversions
  (`SITE_MARKET` selects the display system, default US). Product visuals are parametric
  inline-SVG renders (lattice / wave / true honeycomb), zero image assets.
- **Wishlist**: localStorage (no login), `useSyncExternalStore`-based, accessible toggle; AppBar
  shows the count once hydrated.
- **AI assistant** (open anonymous SSE endpoint `POST /api/ai/chat`):
  - Modes via chips + routing: `shopping`, `size-fit` (deterministic size recommendation),
    `outfit`, `find-shoes` (emits product cards).
  - RAG-lite, zero tool-calling: retrieval (embedding cosine when configured, keyword fallback
    otherwise) → top-4 injected into the system prompt; model answers from injected content only.
  - SSE frame contract `delta | productCards | sizeFit | done | error`, shared `events.ts`
    module client- and server-safe.
  - **Guardrails**: Mock mode by default (empty `AI_API_KEY`); in-memory token-bucket rate limit
    (IP + session), per-session turn cap 20 + history trim (last 6) + idle TTL 30 min,
    output-token cap + request timeout, and a **persisted** daily token budget enforced by SUM
    over the anonymous `ai_usage` table. Soft copy everywhere ("taking a short break").
    `AI_DISABLE_REAL=1` is a one-switch kill back to Mock.
  - FAB ("Need a hand?", hidden on Landing) → right Sheet chat with streamed messages, product
    result cards, context chip on PDP, size-fit entry wired from the PDP.
- **DB**: SQLite via `bun:sqlite` + Drizzle, two tables (`product_embeddings`, `ai_usage`),
  idempotent auto-schema, WAL. Postgres-ready by swapping `DATABASE_URL`.

## 2. Acceptance status (验收状态)

Automated gates — all green at HEAD:

| Gate      | Command                                       | Result                                                 |
| --------- | --------------------------------------------- | ------------------------------------------------------ |
| Typecheck | `bun run typecheck`                           | ✅ exit 0                                              |
| Lint      | `bun run lint`                                | ✅ exit 0                                              |
| Test      | `bun run test`                                | ✅ 28 files / **121 tests** passed                     |
| Build     | `bun run build` (scripts bake in `bun --bun`) | ✅ 22/22 static routes (16 PDP SSG + landing + shells) |

Production-server smoke (`bun run start`, built output) — all recorded from real curls:

- `/` 200 · `/shop` 200 · `/shop?collection=everyday` 200 · `/shop?size=US 9&sort=price-asc` 200
  (also verifies the runtime `/shop` title composition `Shop — Evoloop`, closing a deferred note)
- `/product/daily-drift` 200, `/product/sage-lite` 200 (SSG pages with branded titles)
- `/product/nope` → **HTTP 200** soft 404; body is the not-found shell and carries
  `<meta name="robots" content="noindex"/>` (see open item G1)
- `POST /api/ai/chat` without a key (Mock mode):
  - `find-shoes` → `productCards` (4 real items) + streamed deltas + `done`
  - `shopping` → streamed deltas referencing digest products + `done`
  - `size-fit` with product context → `sizeFit` (EU 43, alternatives) + rationale delta + `done`
  - `size-fit` without a product → soft `error {code:'invalid'}` — no crash
- Real `bun:sqlite` path exercised under the production server: `ai_usage` accumulated rows,
  model correctly logged `mock` (closes the Task-6 "no automated coverage of real bun:sqlite"
  residual for the chat path).

## 3. Open gate items & recommendations (GATE-REQUIRED)

Owned by the whole-branch review / human decision. Headless runs could not cover visual items.

| #   | Item                                                                                                                                                                                                                                                         | Status now                               | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Unknown product handle → HTTP 200 + `noindex` (Next 16 SSG, `dynamicParams=true`, `notFound()`)                                                                                                                                                              | Confirmed live (see smoke)               | Acceptable for a seed demo because the not-found shell is `noindex`ed, so search engines won't index soft-404s. If true 404s become a hard SEO requirement, set `dynamicParams = false` (all 16 known handles still SSG; new products then require rebuild).                                                                                                                                                                                                                                                                                                                                                                         |
| G2  | Package scripts run `next` on Node; `bun:sqlite` requires the Bun runtime ⇒ plain `bun run dev                                                                                                                                                               | build` failed                            | **Fixed in hardening**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Scripts now bake in `bun --bun next dev | build | start`; plain`bun run dev | build | start` works. Deploy must still run Bun. |
| G3  | `/shop` (and PDP) have no persistent AppBar/Footer shell; `/shop` is a nav dead-end except the browser back button                                                                                                                                           | **Fixed (global shell)**                 | AppBar/Footer now live in a shared `SiteShell` mounted by each route group: `(landing)/layout.tsx` uses the transparent `overlay` tone (unchanged pixel design over the dark Hero), `/shop` and `/product/[handle]` use the solid tone, and the root not-found/error pages carry their own `SiteShell` so 404/error keep nav + footer. Wishlist badge therefore shows on every page. Verified: all four routes expose banner + footer, h1 clears the fixed header, no horizontal overflow.                                                                                                                                           |
| G4  | Embedding-mode zero-hit branch unreachable: semantic retrieval ranks all catalog rows without a score floor, so NO_MATCH never fires when embeddings are configured                                                                                          | **Fixed in hardening**                   | Chat-side relevance floor (`score > 0`, conservative because embedding scale is model-dependent) filters orthogonal/negative rows before top-4; regression test asserts low/zero-score hits → NO_MATCH. Retrieval contract unchanged.                                                                                                                                                                                                                                                                                                                                                                                                |
| G5  | `ai_usage.model` logging is detached from the actually-selected provider in both directions: `AI_MODEL ?? 'mock'` mislabels real calls when `AI_MODEL` is unset, and `.env.example` pre-setting `AI_MODEL` mislabels out-of-box Mock calls as the real model | **Fixed in hardening**                   | `provider.aiModel()` derives the model from the actually-selected provider (Mock → `'mock'`; real → `AI_MODEL ?? DEFAULT_AI_MODEL`, shared single source with the streaming client); `chat` records that same value.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| G6  | Size table authoritativeness: fixture is internally consistent; the mandated Zappos/REI spot-check (incl. EU42/US8.5, EU45/US10.5) was not network-verifiable                                                                                                | Deferred (Task 3)                        | Human spot-check against a public size chart before going live in a new market. Known tensions to eyeball: golden `27 cm → EU43` vs `EU43@280 mm`, and JP column approximating foot cm.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| G7  | Small deferred code items                                                                                                                                                                                                                                    | Partially fixed                          | (a) `sizeRangeLabel` malformed output (`"US 9-5"`) when a range spans adjacent half sizes — not triggered by the current seed; (b) ~~`service.test.ts` test #5 empty shell~~ **fixed** — asserts `seedAdapter.getBuyUrl(product) === null`; (c) ~~duplicate SVG `pattern` id between PDP main image and same-view thumbnail~~ **fixed** — `ProductVisual` gains an optional `idSalt` instance salt used by the gallery (`gallery-main` / `gallery-thumb-*`); (d) `metadataBase` hard-coded to `localhost:3000` — needs an env override before deploy; (e) guardrail in-memory maps never evict (single-process assumption, spec P7). |
| G8  | Real-browser visual acceptance                                                                                                                                                                                                                               | **Not performed** (headless environment) | Human checklist in README/report §4. Shell retrofit (G3) was browser-verified headless: banner/footer presence + tone colors + scroll frost + h1 clearance on `/`, `/shop`, `/product/daily-drift`, `/product/nope`.                                                                                                                                                                                                                                                                                                                                                                                                                 |

No Critical findings remain open from any task review; all fix rounds (tasks 7, 10, 11, 12, 13, 17) closed clean at R1/R2 and were re-reviewed.

**Documented size-input quirks** (inherited from the plan brief; safe with the current seed, watch
in future size work): `convert()` is semantically widened beyond its literal signature — for an
out-of-table input it falls back to interpreting the value as a US size when the target system is
EU (and returns `null` otherwise); `parseSizeHint`'s US regex `\b(?:…|m)\s*(\d…)` misjudges an
apostrophe-`m` + digits such as `"I'm 42"` as a US size label.

## 4. Manual browser acceptance checklist (真实浏览器验收清单)

Suggested smoke before calling the branch done:

1. Landing: hero/remote image fallback (offline), Collections/Story anchors, AppBar scroll
   frosted effect + scroll-restore/bfcache tint.
2. `/shop`: rapid multi-filter toggles (no chip snap-back), browser Back/forward through filter
   states, keyboard focus on filter chips, empty-state with query.
3. PDP: gallery view switching (side view honeycomb pattern correct), size selector ARIA,
   Accordion-above-CTA order per spec §9, buy CTA disabled + "Available soon".
4. Wishlist: toggle on grid + PDP, AppBar count updates post-hydration, persists across reload.
5. Assistant: FAB hidden on Landing, visible elsewhere; PDP "Find my size" opens pre-seeded;
   streaming + auto-scroll; Send disabled while streaming; soft error + retry when the backend
   refuses; turn-cap message after ~20 turns; size recommendation unit consistency
   (rationale text shows EU canonical while the block shows the market label — known cosmetic gap).
6. No-key Mock end-to-end (zero cost) and, if a key is available, a real-provider pass.

## 5. Compliance & privacy

No cookies, no analytics/tracking, no login, no PII collected. The assistant sends only the
anonymous session id + message text (+ optional product handle/title context) to the configured
provider; usage is recorded as token counts in the local anonymous `ai_usage` table purely for
the daily budget. Default (no key) mode never contacts any external service — the chat and the
catalog are fully local; only optional remote lifestyle images may load from Unsplash at runtime
with a graceful fallback.

## 6. Next steps (后续)

- Approve this report + G1–G8 decisions, then finish the branch (merge `feat/shoe-store` or open
  a PR as preferred).
- When a Shopify store exists: fill `SHOPIFY_DOMAIN`/`SHOPIFY_STOREFRONT_TOKEN`, implement the
  real Shopify adapter behind the existing `CatalogAdapter` contract, and the buy CTA enables
  itself.
- Before market expansion: human-verify the size table per market (G6) and consider fixing G4/G5.
