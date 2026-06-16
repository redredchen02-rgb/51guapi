---
title: Technical debt optimization — Phase A/C/E remaining work
type: refactor
status: superseded
date: 2026-06-10
origin: docs/brainstorms/2026-06-10-tech-debt-optimization-requirements.md
---

> **状态对账（2026-06-10）**：此计划疑为并发会话产物，方向（继续完成 SQLite 迁移）与
> `docs/plans/2026-06-10-002-fix-stabilize-first-flight-security-plan.md`（回退保 JSON）冲突。
> 运营者已停止该会话；本计划作废，以 06-10-002 为准。

# Technical debt optimization — Phase A/C/E remaining work

## Summary

Complete the remaining integration work for 51publisher's monorepo teardown: wire TypeBox validation into pending-routes, configure Rate Limit and CORS with production-safe env-based defaults, register a unified error handler, wrap extension panels in ErrorBoundary, connect Loading states, migrate Settings.tsx to CSS Modules, add a structured extension logger, and verify that config persistence (already implemented) works correctly.

---

## Problem Frame

The 2026-06-09 optimization plan was 50-60% implemented during Plans 001+002. The remaining work is "last 20% integration" — dependencies installed but not wired, components written but not connected, config files configured but not used. These are small, independent, low-risk changes that together improve production safety, error handling, and code quality without architectural changes.

---

## Requirements

- R1. TypeBox validation on key pending-routes endpoints
- R2. Rate Limit production-safe config (global 100/min, auth 5/min, pending-generate 20/min)
- R3. CORS restricted via `CORS_ORIGIN` env, dev stays wildcard
- R4. Unified `setErrorHandler` on Fastify instance for consistent error body format
- R5. ErrorBoundary wrapping App.tsx and sub-panels
- R6. Loading states on all data-loading panels
- R7. CSS Modules migration on Settings.tsx (priority), BatchView.tsx, PendingTopicsView.tsx
- R8. App.tsx clean up empty CSSProperties + unused imports
- R9. Extension logger abstraction (`lib/logger.ts`)
- R10. Config persistence (already implemented — verify)

---

## Scope Boundaries

- **Only 3 key routes** for TypeBox: pending-topics create, update, delete
- **Only Settings.tsx + BatchView.tsx + PendingTopicsView.tsx** for CSS Modules; App.tsx, DraftPreview, HistoryPanel stay with inline styles
- **No JWT refresh token** (7d access token sufficient for single-operator MVP)
- **No Biome format-all pass** (only applies to modified files)
- **No extension logger → backend transport** (console only, extendable later)
- **No scraper-config persistence** (adapter/site configs remain hardcoded at startup)
- **No Docker / CI platform migration**

---

## Context & Research

### Relevant Code and Patterns

| Area | Key files |
|------|-----------|
| TypeBox schemas | `packages/backend/src/schemas.ts` — existing schemas for LoginBody, LoginResponse, GenerateDraftBody, CreateBatchBody, TriggerScrapeBody |
| Routes needing TypeBox | `packages/backend/src/scraper/pending-routes.ts` — CreatePendingBody, UpdatePendingBody, PendingIdParams |
| Existing TypeBox usage | `packages/backend/src/index.ts` (drafts/generate), `packages/backend/src/auth-routes.ts` (auth/login) |
| Fastify entry | `packages/backend/src/index.ts` — CORS, Rate Limit plugins already imported, not tuned |
| Error format | `packages/backend/src/error-response.ts` — `err()` helper already exists |
| Extension components | `packages/extension/entrypoints/sidepanel/` — ErrorBoundary.tsx, Loading.tsx exist but not wired to sub-panels |
| CSS Modules | WXT/Vite natively supports `*.module.css`, no extra config needed |
| Config persistence | `packages/backend/src/config-store.ts` already uses SQLite `config_store` table (migration 002) |
| Extension logging | `packages/extension/lib/` — raw `console.log(...)` with `[prefix]` convention, no abstraction |
| Scraper-config | `packages/backend/src/scraper/scraper-config.ts` — in-memory only, not persisted (by design) |

### External References

- `@fastify/rate-limit` docs — route-scoped rate limits via `app.post('/path', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, handler)`
- `@fastify/cors` — `origin` supports string, regex, array, or boolean `true`
- Fastify `setErrorHandler` — `app.setErrorHandler((error, request, reply) => { ... })` catches all unhandled errors and validation failures

---

## Key Technical Decisions

- **Rate Limit routes**: auth/login at 5 req/min, pending/generate (which doesn't exist as a route — see R2 note) at 20 req/min. Actually reviewing the code, there is no `pending/generate` route; the scraper routes are at `/api/v1/pending-topics POST`. Apply the stricter limit to `POST /api/v1/pending-topics` and `POST /api/v1/auth/login` instead.
- **setErrorHandler scope**: catches Fastify-validation 400s, unhandled route errors, 404s — all formatted via `err()` helper from `error-response.ts`. Only applied to Fastify-level errors; route-level errors already use `err()` explicitly.
- **CSS Modules scope**: Only migrate components that have 3+ inline style objects to justify the `.module.css` file. Settings.tsx (2) and PendingTopicsView.tsx (1+ growing) qualify; BatchView.tsx has minimal inline styles.
- **Logger format**: `[51publisher] [level] message {context}` — matches existing `[module-name]` console pattern but adds level and structured context.
- **R10 already implemented**: config-store.ts reads/writes `config_store` table in `pending.db`. The `002-config-store.sql` migration creates the table. Config-routes persist field mappings to this table on PUT and reload on GET. Verified: no code changes needed.

---

## Implementation Units

### U1. TypeBox schema for pending-routes

**Goal:** Add TypeBox validation schemas for `POST /api/v1/pending-topics`, `PATCH /api/v1/pending-topics/:id`, `DELETE /api/v1/pending-topics/:id`

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `packages/backend/src/schemas.ts`
- Modify: `packages/backend/src/scraper/pending-routes.ts`
- Create: `packages/backend/src/scraper/pending-routes.test.ts`

**Approach:**
- Add `CreatePendingBody`, `UpdatePendingBody`, `PendingIdParams` TypeBox schemas to `schemas.ts`
- In `pending-routes.ts`, replace local `interface CreatePendingBody` / `UpdatePendingBody` / `PendingIdParams` with imports from `schemas.ts`
- Wire schemas into route `schema: { body, params }` blocks
- Keep existing manual validation (`if (!sourceUrl || !siteName || !title)`) as defense-in-depth — TypeBox handles shape, manual handles business logic

**Patterns to follow:**
- `packages/backend/src/schemas.ts` — existing `CreateBatchBody` schema for array/string patterns
- `packages/backend/src/index.ts` drafts/generate route for `schema: { body, response }` wiring

**Test scenarios:**
- Happy path: `POST /api/v1/pending-topics` with valid body `{ sourceUrl, siteName, title }` → 200 + `ok: true`
- Edge: Empty body → 400 from Fastify validation (via setErrorHandler)
- Edge: Missing required field `title` → 400
- Edge: `PATCH /api/v1/pending-topics/:id` with non-existent ID → 404 with `ok: false` error body

**Verification:**
- TypeBox rejects invalid input shapes before handler executes (400 vs 500)
- Existing manual validation still fires on valid-shape but semantically-invalid input
- `DELETE` route rejects non-numeric/empty `:id` if validation schema constrains it

---

### U2. Backend infra sweep: Rate Limit, CORS, error handler

**Goal:** Production-safe Rate Limit with route-scoped limits, `CORS_ORIGIN` env-based origin restriction, unified `setErrorHandler` for all Fastify-level errors

**Requirements:** R2, R3, R4

**Dependencies:** None (independent — can run in parallel with U1)

**Files:**
- Modify: `packages/backend/src/index.ts`
- Modify: `.env.example`
- Create: `packages/backend/src/index.test.ts` (for error handler + Rate Limit)

**Approach:**
- **Rate Limit (R2):** Keep global `max: 100` default. Add route-scoped limit to `POST /api/v1/auth/login` (`max: 5`) and `POST /api/v1/pending-topics` (`max: 20`). Use `@fastify/rate-limit` route config: `app.post(path, { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, handler)`. Make the global `max` configurable via `RATE_LIMIT_MAX` env (default `100`).
- **CORS (R3):** Keep `CORS_ORIGIN` env logic already there (`origin: '*'` default for dev). Update `.env.example` to document the var. No functional change needed — just documentation.
- **Error handler (R4):** Add `app.setErrorHandler()` that catches Fastify `FastifyError` instances and formats them as `{ ok: false, error: message, kind?: string }` matching `error-response.ts` format. Handle 400/401/404/413/429/500 consistently. The `err()` helper already formats route-level errors — this catches anything that slips through.

**Patterns to follow:**
- `error-response.ts` `err()` function — target format for setErrorHandler output
- `@fastify/rate-limit` docs for route-scoped config

**Test scenarios:**
- Happy: Normal request on non-limited route → 200
- Rate Limit: `POST /api/v1/auth/login` 6th consecutive request → 429 `{ ok: false, error: "Rate limit exceeded" }`
- CORS: Origin not in `CORS_ORIGIN` → 403 (no `access-control-allow-origin` header, or blocked by browser CORS policy)
- Error handler: Malformed JSON body → 400 with `{ ok: false, error: ... }` format
- Error handler: Route that `throw Error('test')` → 500 with `{ ok: false, error: ... }`

**Verification:**
- `curl -X POST http://localhost:3001/api/v1/auth/login -H 'Content-Type: application/json' -d '{"password":"wrong"}'` 6x → 6th returns 429
- `curl -v -H 'Origin: https://evil.com' http://localhost:3001/api/v1/models` → no `access-control-allow-origin: *`
- `curl -X POST http://localhost:3001/api/v1/auth/login -d 'not json'` → 400 with error body

---

### U3. ErrorBoundary wrapping

**Goal:** Wrap App.tsx and sub-panels in ErrorBoundary to prevent complete white-screen crash

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/BatchView.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/PendingTopicsView.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/HistoryPanel.tsx`

**Approach:**
- App.tsx currently imports `ErrorBoundary` (line 6) but doesn't wrap anything — all components render directly inside `<Wrap>`
- App.tsx: Wrap `<Wrap>` children with `<ErrorBoundary>` as outer layer
- BatchView, PendingTopicsView, HistoryPanel: each wrap their root element with `<ErrorBoundary>` with a panel-specific fallback message
- Keep the global boundary in main.tsx as ultimate fallback

**Patterns to follow:**
- Existing `ErrorBoundary` component usage — wraps child components, provides fallback with retry button

**Test scenarios:**
- Happy: Normal render → no change to existing UI
- Edge: `throw new Error('test')` inside BatchView → panel shows ErrorBoundary fallback, not white screen
- Edge: `throw new Error('test')` inside App.tsx root → main boundary catches, shows global fallback

**Verification:**
- Inject a simulated error in dev tools → component tree shows ErrorBoundary fallback
- Console shows `[ErrorBoundary]` error log
- Retry button restores the component

---

### U4. Loading states connection

**Goal:** Show `<Loading />` component during data fetching in all panel views

**Requirements:** R6

**Dependencies:** None (independent of U3)

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/PendingTopicsView.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/BatchView.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/HistoryPanel.tsx`

**Approach:**
- PendingTopicsView: Add `loading: boolean` state. Set `true` before `fetchPendingTopics()` call, `false` after. When loading, render `<Loading message="加载待审核选题…" />` instead of the topic list.
- BatchView: Add `loading: boolean` state. Show `<Loading />` during batch creation/reload.
- HistoryPanel: Add loading state around its data fetch.

**Patterns to follow:**
- App.tsx line 114: `<Loading />` already used during auth check
- `Loading.tsx` component already accepts `message` prop

**Test scenarios:**
- Happy: PendingTopicsView loads → shows spinner, then topics list appears
- Edge: Network failure → spinner transitions to error message (not stuck loading)
- Edge: Empty list → no spinner (already loaded), shows "暂无待审核选题"

**Verification:**
- Open PendingTopicsView with network throttling → spinner visible during fetch
- `<Loading>` uses `role="status"` and `aria-live="polite"` — accessibility preserved

---

### U5. CSS Modules migration + App.tsx cleanup

**Goal:** Migrate Settings.tsx inline styles to `.module.css`, clean up App.tsx empty CSSProperties

**Requirements:** R7 (partial: Settings.tsx only), R8

**Dependencies:** None

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/Settings.module.css`
- Modify: `packages/extension/entrypoints/sidepanel/Settings.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx`

**Approach:**
- **Settings.module.css:** Extract `inputStyle`, `labelStyle` into CSS classes. Add classes for: `.input`, `.label`, `.monoInput`, `.error`, `.sectionTitle`, `.saveButton`. Use CSS custom properties from existing `index.css`.
- **Settings.tsx:** Import `styles` from `./Settings.module.css`, replace `style={{ ... }}` with `className={styles.input}` etc. Keep dynamic styles (`style={{ marginTop: ... }}`) inline when they vary; move static styles to CSS.
- **App.tsx:** Remove empty `const btn`, `const primaryBtn`, `const plainBtn` declarations (lines 17-19). They are unused — React buttons use `className="btn btn-plain"` or `className="btn btn-primary"`.
- BEM naming for CSS classes: `.settings__input`, `.settings__label`, etc., scoped by module.

**Test expectation:** No behavioral change — visual regression only. Verify via screenshot or manual check that Settings page looks identical before and after.

**Verification:**
- `lsp_diagnostics` clean on all modified files
- Build succeeds (`pnpm --filter extension build`)
- Settings page elements render with same spacing, fonts, colors
- App.tsx has no React.CSSProperties declarations at module level

---

### U6. Extension logger

**Goal:** Create a structured logger abstraction for the extension, migrate existing `console.log` calls in `lib/`

**Requirements:** R9

**Dependencies:** None

**Files:**
- Create: `packages/extension/lib/logger.ts`
- Modify: `packages/extension/lib/config-client.ts`
- Modify: `packages/extension/lib/batch-orchestrator.ts`
- Modify: (optionally) other `lib/` files with console.log calls
- Create: `packages/extension/lib/logger.test.ts`

**Approach:**
- Create `logger.ts` with:
  ```typescript
  type LogLevel = 'info' | 'warn' | 'error' | 'debug';
  type LogContext = Record<string, unknown>;
  
  const PREFIX = '[51publisher]';
  const ENABLED_LEVELS: Record<LogLevel, boolean> = {
    debug: import.meta.env.DEV ?? true,
    info: true,
    warn: true,
    error: true,
  };
  
  function log(level: LogLevel, module: string, message: string, context?: LogContext): void {
    if (!ENABLED_LEVELS[level]) return;
    const parts = [PREFIX, `[${level}]`, `[${module}]`, message];
    if (context) parts.push(JSON.stringify(context));
    if (level === 'error') console.error(...parts);
    else if (level === 'warn') console.warn(...parts);
    else console.log(...parts);
  }
  
  export const logger = {
    info: (module: string, message: string, ctx?: LogContext) => log('info', module, message, ctx),
    warn: (module: string, message: string, ctx?: LogContext) => log('warn', module, message, ctx),
    error: (module: string, message: string, ctx?: LogContext) => log('error', module, message, ctx),
    debug: (module: string, message: string, ctx?: LogContext) => log('debug', module, message, ctx),
  };
  ```
- Migrate `config-client.ts` and `batch-orchestrator.ts` to use `logger.info('config-client', '...')` etc.
- Keep `console.error` for crash-level errors that should always appear
- Debug level disabled in production via `import.meta.env.DEV`

**Patterns to follow:**
- Existing console.log format: `[config-client] 成功拉取远程映射 (version=%d)` → migrate to `logger.info('config-client', '成功拉取远程映射', { version })`
- Existing console.warn format: `[batch-orchestrator] 轨迹快照含机密被丢弃...` → migrate to `logger.warn('batch-orchestrator', '轨迹快照含机密被丢弃', { itemId })`

**Test scenarios:**
- Happy: `logger.info('test', 'hello', { id: 1 })` → console output matches `[51publisher] [info] [test] hello {"id":1}`
- Edge: `logger.debug('test', 'verbose')` → silent in production mode
- Edge: No context → output `[51publisher] [info] [test] hello` without trailing JSON

**Verification:**
- `__TEST__` run of logger.ts produces expected console output format
- Existing lib/ files compile without errors after migration
- WXT build succeeds

---

### Verified: R10 — Config persistence (no changes needed)

**Status: Already implemented**

Verification checklist:
- `packages/backend/src/config-store.ts` — `configGet()`/`configSet()` read/write `config_store` table in `pending.db` via `getDb()` ✓
- `packages/backend/src/migrations/runner.ts` — `002-config-store.sql` creates `config_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)` ✓
- `packages/backend/src/config-routes.ts` — `registerConfigRoutes` uses `configGet()`/`configSet()` for field mappings ✓
- `packages/backend/src/index.ts` — calls `initPendingDb()` before `registerConfigRoutes()` ✓

**Verification:**
- Start backend, `curl -X PUT -H 'Content-Type: application/json' -d '{"mappings": {...}}' http://localhost:3001/api/v1/config/mappings` → persists to SQLite
- Stop backend, restart, `curl http://localhost:3001/api/v1/config/mappings` → returns the previously stored mapping
- SQLite `config_store` table contains the expected key/value rows

---

## System-Wide Impact

- **Interaction graph:** `setErrorHandler` affects ALL routes — verify it doesn't swallow expected non-standard error responses
- **Error propagation:** Unified format means extension error handling (which reads `ok: false`) becomes more reliable — no more ad-hoc error shapes
- **State lifecycle risks:** None — all units are additive or cosmetic
- **API surface parity:** Rate Limit and CORS changes affect existing API consumers (the extension); verify extension still works end-to-end
- **Integration coverage:** The extension's `fetchPendingTopics()` and login flow must still work after TypeBox + Rate Limit changes
- **Unchanged invariants:** All existing routes, response shapes, and auth mechanism remain unchanged

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| setErrorHandler may double-wrap route-level errors that already call `err()` | Test with an existing error route: it should not produce `{ ok: false, error: "...", ok: false, error: "..." }`. The handler should only fire for unhandled errors. |
| Rate Limit in test suite makes parallel tests flaky | Use `RATE_LIMIT_MAX=1000` env in CI or disable rate limiting in test mode |
| CSS Modules migration may introduce visual regressions | Manual visual check after migration — same renders, same layout |
| Logger abstraction may change production console behavior (debug logs leaking) | Debug level gated by `import.meta.env.DEV` — silent in production build |

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-10-tech-debt-optimization-requirements.md](file:///Users/dex/YDEX/INPORTANT%20WORK/发帖/51publisher/docs/brainstorms/2026-06-10-tech-debt-optimization-requirements.md)
- Fastify setErrorHandler: https://fastify.dev/docs/latest/Reference/Server/#seterrorhandler
- @fastify/rate-limit route config: https://github.com/fastify/fastify-rate-limit#route-configuration
