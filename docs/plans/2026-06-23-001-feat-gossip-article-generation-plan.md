---
title: "feat: Gossip Article Generation — Full Structured Article per 规范七/八"
type: feat
status: active
date: 2026-06-23
deepened: 2026-06-23
---

# feat: Gossip Article Generation — Full Structured Article per 规范七/八

## Overview

Currently, when a gossip topic is approved, the system can generate a simple 5-section draft (`DraftSlots`: titleSuffix / subtitle / intro / highlights / outro). This plan adds a **full structured article generation** path that produces a 9-section layout per the editorial spec (规范七：标题与正文撰写规范, 规范八：标签与关键词规范).

The new format includes: title, intro (80-120 chars), preview image slot, quick-info table, event narrative (100-200 chars), image showcase section, video intro section, FAQ (3-5 Q&A), and conclusion (~80 chars). The same anti-hallucination invariant holds: model writes prose only; factual values (当事人, 发生时间, 来源连结) are verbatim-injected from `GossipFactsBlock`.

## Problem Frame

The simple draft covers basic title + body, but the editorial workflow needs a ready-to-publish structure with clearly separated sections, quick-info metadata, FAQ, and content-grounded tags. Editors currently have to manually build the full article structure after receiving the simple draft. This plan automates the structured layout while keeping the anti-hallucination guarantee.

## Requirements Trace

- R1. Title 25-35 chars; structure: person + event keyword + core angle; must use hedging words (网传/疑似/被曝) for unverified facts.
- R2. Intro prose: 80-120 chars; no title repetition; LLM-generated text only.
- R3. Quick-info table: extract up to 7 fields from `GossipFactsBlock`; omit absent fields; never fabricate.
- R4. Event narrative: 100-200 chars; chronological; based only on available facts.
- R5. Image / video sections: placeholder markers in HTML; no LLM-invented descriptions of unseen media; user fills in actual media.
- R6. FAQ: 3-5 Q&A; generated per article content; answers hedge unverified claims.
- R7. Conclusion: ~80 chars; no new information; no title/intro repetition.
- R8. Tags: 3-5; objective words only; blocklist of marketing words enforced programmatically.
- R9. Same anti-hallucination invariant as existing pipeline: `sanitizeToPlainText + esc` on all prose; no model-invented URLs in body.
- R10. `ContentDraft` wire shape unchanged; article body stored in existing `body: string` (HTML) field.

## Scope Boundaries

- Not in scope: automatic image/video selection, ordering, or upload.
- Not in scope: publishing or writing to any external site.
- Not in scope: changes to the ACG (non-gossip) draft pipeline.
- Not in scope: UI redesign of DraftPreview beyond article-section labels.

## Context & Research

### Relevant Code and Patterns

- `packages/shared/src/post-assembler.ts` — `DraftSlots`, `assembleGossipDraft()`, `sanitizeToPlainText()`, `esc()` — direct pattern to follow.
- `packages/shared/src/gossip-facts.ts` — `GossipFactsBlock`, field keys — the verbatim data source.
- `packages/backend/src/services/draft-gen.ts` — `DRAFT_SLOTS_SCHEMA`, `buildRequest()`, `generateDraft()`, `slotsFromParsed()` — LLM service pattern to mirror.
- `packages/backend/src/services/fetch-backoff.ts` — `LlmDeps`, `fetchWithBackoff()` — shared LLM fetch pattern.
- `packages/backend/src/app.ts` — `registerDraftRoutes()`, existing `/api/v1/drafts/generate` — route registration pattern.
- `packages/shared/src/types.ts` — `ContentDraft`, `GenerateDraftResponse` — unchanged wire types.
- `packages/shared/src/draft.ts` — `toDraft()` — assembles `ContentDraft` from assembled fields.
- `packages/extension/entrypoints/sidepanel/pending/GenerateConfirmDialog.tsx` — trigger point for adding "生成完整文章" option.

### Institutional Learnings

- Anti-hallucination invariant (post-assembler): body URLs must come from `facts.來源連結` verbatim; prose fields go through `sanitizeToPlainText + esc`. The grounding gate in `draft-gen.ts` verifies this.
- `DraftSlots` keeps model-writable fields structurally separate from fact fields — `ArticleSlots` follows the same discipline.
- LLM schema: use `json_object` fallback when `json_schema` returns 400 (some models). Mirror the `for (const useSchema of [true, false])` retry logic.
- `sanitizeToPlainText` strips HTML tags and bare URLs — any model-produced prose must pass through it before entering the body.
- Tag validation: existing `THEME_ALLOWLIST` in `gossip-theme.ts` shows the allow-list pattern; marketing-word blocklist follows the same approach.

## Key Technical Decisions

- **New `ArticleSlots` type, separate from `DraftSlots`**: The article format has structurally different fields (FAQ array, named sub-sections). Extending `DraftSlots` would add optional fields that the assembler cannot treat uniformly. A dedicated `ArticleSlots` in `article-assembler.ts` is cleaner and independently testable.
- **Article body as HTML sections in `ContentDraft.body`**: Avoids changing the wire type `ContentDraft`, which is consumed by the extension, export pipeline, and backend. Sections are delineated with HTML comments (`<!-- section:intro -->`) so future UI can parse them without format coupling.
- **New route `POST /api/v1/drafts/generate-article`**: Rather than adding a `format` param to the existing route, a new route avoids conditional branching in existing code and keeps the article LLM schema isolated.
- **Tag marketing-word blocklist in `@51guapi/shared`**: Validation is pure logic, shared between backend (enforce at generation) and future extension-side display. Mirrors `THEME_ALLOWLIST` pattern.
- **Image/video as `【待补】` placeholders**: The scraper does not reliably extract all images; the `coverImageUrl` field holds at most one. Placeholder markers in HTML preserve the section structure while flagging what the editor must fill in. This upholds R5.
- **Article body must not be rendered as HTML in the extension**: The CLAUDE.md constraint applies — `dangerouslySetInnerHTML` requires simultaneous DOMPurify sanitization. `DraftPreview` and `GenerateConfirmDialog` must continue to display article body via textarea/`textContent` (same as today). The 9-section body is longer and more complex than simple draft, making this constraint more critical.
- **`ARTICLE_SLOTS_SCHEMA` lives in backend only**: The JSON schema constant for OpenAI structured output belongs in `draft-article-gen.ts` (backend), not in `@51guapi/shared`. The `ArticleSlots` TypeScript interface belongs in shared; the wire format constant does not.

## Open Questions

### Resolved During Planning

- *Can `ContentDraft.body` hold 9-section HTML without type change?* Yes — `body` is already `string` (HTML); the sections are HTML markup, no schema change needed.
- *Does the article generation reuse `GenerateDraftResponse` as the return type?* Yes — the assembler outputs `ContentDraft` just as the simple draft does; the same response envelope fits.
- *Where is the feature triggered in the UI?* `GenerateConfirmDialog.tsx` gets a `mode` prop (`'draft' | 'article'`); PendingTopicsView passes the mode and calls the appropriate endpoint.

### Deferred to Implementation

- Exact LLM prompt wording for the article format — the prompt is implementation-specific and will be tuned during execution.
- Whether to add a `sectionType: 'article'` marker to `ContentDraft` for UI rendering hints — the current plan avoids it to keep the type unchanged, but the implementer may revisit if section-aware preview is needed.
- Title length enforcement (25-35 chars) — the assembler will produce the title but cannot truncate model prose without breaking meaning; a warning flag (like `qualityWarnings`) is the appropriate response rather than hard truncation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
GossipFactsBlock (verbatim)
         │
         ▼
LLM prompt (facts injected as read-only context)
         │
         ▼ json_schema / json_object fallback
  ArticleSlots {
    titleSuffix, intro, narrative,
    highlights?, faqItems[], conclusion,
    tags[], keywords[]
  }  ← model writes ONLY these prose fields
         │
         ▼
assembleGossipArticle(slots, facts)
  ├─ title      = facts.當事人 + sanitize(titleSuffix)  [length check in U3]
  ├─ intro      = sanitize(slots.intro) → esc
  ├─ quickInfo  = table from facts (verbatim esc; skip null fields)
  ├─ narrative  = sanitize(slots.narrative) → esc
  ├─ images     = static 【待补：图片】  (no model input, no <a href>)
  ├─ video      = static 【待补：视频说明】  (no model input)
  ├─ faq        = faqItems[].{q, a} → sanitize+esc each field
  ├─ conclusion = sanitize(slots.conclusion) → esc
  └─ sourceLink = renderLink("來源連結", facts.來源連結)  ← only <a href> in body
         │
         ▼
  AssembledArticle { title, body(HTML), description, tags, keywords }
         │
         ▼
  toDraft(assembled) → ContentDraft (unchanged shape)
         │
         ▼
  validateArticleTags(draft.tags) → qualityWarnings[]
         │
         ▼
  GenerateDraftResponse { ok: true, draft, qualityWarnings? }
```

## Implementation Units

```
U1 ─────────────────────────────────┐
(ArticleSlots + assembler in shared) │
                                     │
U2 ────────────────────────────────► U3 ──────────► U4 ──────────► U5
(tag validation in shared)      (backend service)  (new route)  (extension UI)
```

- [ ] **Unit 1: `ArticleSlots` + `assembleGossipArticle()` in `@51guapi/shared`**

**Goal:** Define the model-writable slot interface and the pure assembly function that combines slots with facts into a 9-section HTML body.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R9, R10

**Dependencies:** None

**Files:**
- Create: `packages/shared/src/article-assembler.ts`
- Create: `packages/shared/src/article-assembler.test.ts`
- Modify: `packages/shared/src/index.ts` (export new types + functions)

**Approach:**
- `ArticleSlots`: `{ titleSuffix?, intro, narrative, highlights?, faqItems: {q:string; a:string}[], conclusion, tags: string[], keywords?: string[] }`
- `AssembledArticle`: `{ title, subtitle, body, description, tags, keywords }`
- `assembleGossipArticle(slots, facts)`:
  - Title: `facts.當事人 + sanitizeToPlainText(slots.titleSuffix)` → returned as-is (no truncation, no metadata flag from assembler); length check done in U3 after assembly
  - Quick-info table: iterate `GossipFactsBlock` keys; skip null/empty; verbatim inject via `esc()`
  - Narrative: `sanitizeToPlainText(slots.narrative)` + `esc()`; flag if outside 100-200 chars
  - Image placeholder: 1 block of `<!-- section:images -->【待补：图片】`
  - Video placeholder: 1 block of `<!-- section:video -->【待补：视频说明】`
  - FAQ: each `{q, a}` — both question and answer go through `sanitizeToPlainText()` then `esc()`; question is model-generated prose, not a verbatim fact, so same treatment as answer
  - Conclusion: `sanitizeToPlainText(slots.conclusion)` + `esc()`
  - Source link: `facts.來源連結` verbatim with `renderLink()` (same as `assembleGossipDraft`)
  - Section wrappers: HTML comments `<!-- section:intro -->`, `<!-- section:quickinfo -->`, etc. — **prose fields must not contain `-->` sequences**: `sanitizeToPlainText` strips HTML tags via `/<[^>]*>/g` but does not catch comment terminators; add a post-sanitize replace of `-->` → ` ` before injecting prose inside HTML comment wrappers

**Patterns to follow:**
- `assembleGossipDraft()` in `post-assembler.ts` — same `sanitizeToPlainText + esc` discipline
- `PLACEHOLDER = "【待补】"` for missing fact fields
- `renderLink()` for source link injection

**Test scenarios:**
- Happy path: full facts + full slots → body contains all 9 sections in order, no bare URLs in prose blocks
- Edge case: `facts.當事人 = null` → title is `PLACEHOLDER`; quick-info table omits 当事人 row
- Edge case: `faqItems = []` → FAQ section present but empty (no fabricated Q&A)
- Edge case: `slots.narrative` contains a URL → URL replaced with `PLACEHOLDER` via `sanitizeToPlainText`
- Edge case: `slots.intro` contains HTML tags → tags stripped
- Grounding (specific): body contains exactly one `<a href>` when `facts.來源連結` is set, and that href value equals `facts.來源連結` verbatim; when `facts.來源連結` is null, body contains zero `<a href>` tags (meaningful regression form of grounding invariant — the generic `verifyLinks` call passes trivially and does not catch assembler regressions)
- Sanitize coverage: a bare URL in `slots.intro`, `slots.narrative`, `slots.conclusion`, `faqItems[].q`, or `faqItems[].a` is replaced with `【待补】` — not passed through to the body
- Title length: assembled title outside 25-35 chars → returned as-is by assembler; U3 emits a `qualityWarning`

**Verification:** `pnpm test --filter @51guapi/shared` passes with new test file; `pnpm compile` clean.

---

- [ ] **Unit 2: Tag/keyword validation utilities in `@51guapi/shared`**

**Goal:** Pure validation functions for article tags (3-5 count, no marketing words) and keywords (must appear in title+body).

**Requirements:** R8

**Dependencies:** None (pure logic, no cross-unit deps)

**Files:**
- Create: `packages/shared/src/article-tags.ts`
- Create: `packages/shared/src/article-tags.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

**Approach:**
- `MARKETING_WORD_BLOCKLIST: string[]` — includes: `["爆款", "必看", "炸裂", "刺激到不行", "最好看", "顶级", "神仙"]`
- `validateArticleTags(tags: string[]): { ok: boolean; errors: string[] }`:
  - `tags.length < 3` → error "标签不足3个"
  - `tags.length > 5` → error "标签超过5个"
  - any tag in blocklist → error "含营销词: X"
  - empty string tags → error "存在空标签"
**Patterns to follow:** `THEME_ALLOWLIST` / `parseThemes()` in `gossip-theme.ts` (note: tag validation is a **blocklist** — any match is flagged — inverted from THEME_ALLOWLIST's allowlist semantics)

**Test scenarios:**
- Happy path: `["出軌", "明星A", "社交媒体"]` → `{ ok: true, errors: [] }`
- Error path: `["爆款", "炸裂"]` → `{ ok: false, errors: ["标签不足3个", "含营销词: 爆款", "含营销词: 炸裂"] }`
- Error path: 6 tags → `{ ok: false, errors: ["标签超过5个"] }`
- Error path: `["", "出軌", "明星"]` → empty string error

**Verification:** `pnpm test --filter @51guapi/shared` passes.

---

- [ ] **Unit 3: `draft-article-gen.ts` backend service**

**Goal:** LLM call → parse `ArticleSlots` → call `assembleGossipArticle()` → validate tags → return `GenerateDraftResponse`.

**Requirements:** R1–R9

**Dependencies:** U1 (shared assembler), U2 (tag validation)

**Files:**
- Create: `packages/backend/src/services/draft-article-gen.ts`
- Create: `packages/backend/src/services/draft-article-gen.test.ts`

**Approach:**
- `ARTICLE_SLOTS_SCHEMA`: OpenAI json_schema for `ArticleSlots` (`faqItems` as `array` of `{q: string, a: string}` objects)
- `buildArticlePrompt(facts: GossipFactsBlock): string`: constructs prompt that:
  - Injects facts as a **fenced JSON block** (e.g., triple-backtick labeled `json`) — not raw prose — to prevent prompt injection: scraped page text could contain instruction-like substrings if pasted undelimited
  - Instructs model to write prose slots only (no facts, no URLs, no invented names)
  - Specifies char count targets per section (intro 80-120, narrative 100-200, conclusion ~80)
  - Injects 规范七/八 key rules (hedging words, no marketing tags)
- `generateArticleDraft(facts: GossipFactsBlock, deps: LlmDeps): Promise<GenerateDraftResponse>`:
  - `deps.facts` is set to the gossip facts (passed by the route handler)
  - Calls LLM with `json_schema` / `json_object` fallback (same two-pass `for (useSchema of [true, false])` pattern as `draft-gen.ts`)
  - Parses response into `ArticleSlots` (gracefully handle `faqItems` missing/non-array → default `[]`)
  - Calls `assembleGossipArticle(slots, facts)`
  - Checks `assembled.title.length`; if < 25 or > 35 pushes `"标题长度超出规范(25-35字)"` to `qualityWarnings` (non-blocking)
  - Validates tags with `validateArticleTags()` → non-blocking, adds errors to `qualityWarnings`
  - Runs grounding gate: `hasUnsourcedLink(verifyLinks(body, gossipFactUrls(facts)))` → hard reject if fails
  - Builds `ContentDraft` via `toDraft(assembled, category, tags, id, now)`
  - Returns `{ ok: true, draft, qualityWarnings }` where `qualityWarnings` includes tag validation errors

**Patterns to follow:**
- `generateDraft()` in `draft-gen.ts` — two-pass json_schema/json_object, backoff, grounding gate
- `fetchWithBackoff()` from `fetch-backoff.ts`
- `callLlmForJson()` pattern for parsing
- Same `LlmDeps` interface

**Test scenarios:**
- Happy path: valid `ArticleSlots` from LLM → returns `ok: true` with 9-section body
- Error path: LLM returns invalid JSON → `{ ok: false, kind: 'format', error: ... }`
- Error path: LLM response contains body URL not in facts → `{ ok: false, kind: 'grounding', error: ... }`
- Tag validation: LLM-returned tags with marketing word → `qualityWarnings` includes the tag error (not hard reject)
- Edge case: empty `faqItems` array from LLM → FAQ section present with no items, no error
- Network error → `{ ok: false, kind: 'network', error: ... }`

**Verification:** `pnpm test --filter @51guapi/backend` passes with new test file.

---

- [ ] **Unit 4: New route `POST /api/v1/drafts/generate-article` in backend**

**Goal:** HTTP endpoint that accepts `{ topicId, settings? }`, fetches the PendingTopic, calls `generateArticleDraft`, returns `GenerateDraftResponse`.

**Requirements:** R10 (reuse existing response type)

**Dependencies:** U3

**Files:**
- Modify: `packages/backend/src/app.ts` — add route **inside the existing `registerDraftRoutes()` function** (alongside existing `/api/v1/drafts/generate`; no new registration call in `index.ts`)
- Modify: `packages/backend/src/utils/schemas.ts` (add `GenerateArticleBody` JSON schema)
- Create: `packages/backend/src/routes/drafts-generate-article.test.ts`

**Approach:**
- Body schema: `{ topicId: string (required) }` — no `settings` in request body; settings read server-side via `getLlmConfig()` (same as `gossip-routes.ts`); caller must not override LLM endpoint/key
- TypeBox body schema `GenerateArticleBody`: `Type.Object({ topicId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }) })` — validate format before DB lookup
- **`GenerateArticleResponse` TypeBox schema** (new, in `schemas.ts`): must explicitly declare `qualityWarnings: Type.Optional(Type.Array(Type.String()))` — Fastify+TypeBox silently strips undeclared response fields (confirmed: existing `GenerateDraftResponse` schema only declares `ok`, `slots`, `draft`; `qualityWarnings` is absent and stripped today)
- Route: `app.post('/api/v1/drafts/generate-article', { rateLimit: { max: 20, timeWindow: '1 minute' }, schema: { body: GenerateArticleBody, response: { 200: GenerateArticleResponse } } }, handler)`
- Handler:
  1. Fetch `PendingTopic` by `topicId` via `loadPendingTopic(id)` (already exists in `pending-store.ts` line 224) — 404 if not found
  2. Guard: `topic.domain && topic.domain !== 'gossip'` → 400 "Article generation only supported for gossip topics" (allows legacy topics where `domain` is `undefined`; blocks explicit `domain: 'acg'`)
  3. Type guard: call `isGossipFactsBlock(topic.facts)` (check for presence of `當事人` key from `GOSSIP_FACT_KEYS`); return 400 if facts not gossip-shaped — prevents unsafe cast when stored facts are ACG or partial
  4. Build `LlmDeps` from `getLlmConfig()` (env config only — no caller-supplied settings to prevent LLM endpoint SSRF)
  5. Call `generateArticleDraft(topic.facts as GossipFactsBlock, deps)`
  6. Return result (same `err()` / `recordDraft()` pattern as `/generate`)

**Patterns to follow:** Existing `/api/v1/drafts/generate` handler in `app.ts`; `registerGossipRoutes` for topic fetch pattern.

**Test scenarios:**
- Happy path: valid topicId (gossip domain) → 200 with article body
- Error path: topicId not found → 404
- Error path: topic domain = 'acg' → 400
- Error path: LLM not configured → 500 with `kind: 'no-key'`
- Integration: response body's `body` field contains `<!-- section:intro -->` marker
- TypeBox/Fastify boundary: when tag validation produces errors, the HTTP response's `qualityWarnings` field is non-empty (regression test that TypeBox serialization does not strip it)

**Verification:** `pnpm test --filter @51guapi/backend` passes; `curl` against running backend returns 201 with section markers in body.

---

- [ ] **Unit 5: Extension UI — Article generation mode**

**Goal:** Add "生成完整文章" as an alternative action in the pending topics view, calling `/api/v1/drafts/generate-article`.

**Requirements:** Triggers article generation from the approved topic list.

**Dependencies:** U4 (route must exist)

**Files:**
- Modify: `packages/extension/entrypoints/background.ts` — add `GENERATE_ARTICLE` handler (mirrors `GENERATE_DRAFT` at line 86)
- Modify: `packages/extension/lib/messages.ts` (or wherever `RuntimeMessage` union is defined) — add `{ type: 'GENERATE_ARTICLE'; topicId: string }` to the union
- Modify: `packages/extension/lib/llm.ts` — add `generateArticle(topicId: string, deps?)` function (same `authHeaders()` / 401 `clearToken()` pattern; calls `POST /api/v1/drafts/generate-article`)
- Modify: `packages/extension/entrypoints/sidepanel/pending/GenerateConfirmDialog.tsx` — add `onConfirmArticle?: () => void` prop + "生成完整文章(规范)" button
- Modify: `packages/extension/entrypoints/sidepanel/PendingTopicsView.tsx` (or hook under `hooks/`) — add `handleGenerateArticle` handler that sends `GENERATE_ARTICLE` message

**Approach:**
- **Decision: Route via background service worker (Option A)** — consistent with `GENERATE_DRAFT` pattern; preserves SW keepalive timeout (≥65s watchdog in messaging.ts); article generation is longer than simple draft and more at risk if SW is killed mid-flight
- Flow: sidepanel → `browser.runtime.sendMessage({ type: 'GENERATE_ARTICLE', topicId })` → `background.ts` handler → `generateArticle(topicId)` in `lib/llm.ts` → `POST /api/v1/drafts/generate-article`
- Add SW timeout entry for `GENERATE_ARTICLE` in messaging.ts with timeout ≥ backend timeout for the route
- `GenerateConfirmDialog` gets `onConfirmArticle?: () => void`; renders "生成完整文章(规范)" button only when prop is provided
- `handleGenerateArticle` in PendingTopicsView: sends background message → on `ok: true`, sets draft state (same flow as `GENERATE_DRAFT` response)

**Patterns to follow:**
- `GENERATE_DRAFT` handler in `background.ts:86` — message routing + LLM call + response relay pattern
- `generateDraft()` in `lib/llm.ts` — auth headers, error handling, response shape

**Test scenarios:**
- Happy path: "生成完整文章" button visible when `onConfirmArticle` prop is provided
- Happy path: clicking button calls `onConfirmArticle` callback
- Edge case: `onConfirmArticle` undefined → only "确认生成" shown (backward compatible)
- Integration: end-to-end flow with stub backend returns article draft and renders in DraftPreview

**Verification:** Extension builds (`pnpm build:extension`); both buttons appear for gossip topics; clicking "生成完整文章" triggers the new route.

## System-Wide Impact

- **Interaction graph:** New route is gated behind same JWT auth middleware as existing draft routes (`registerDraftRoutes`). New `pending-store` read (by topicId) reuses existing `getPendingTopic` — no new DB schema changes.
- **Error propagation:** LLM errors surface as `GenerateDraftResponse { ok: false }` (same envelope); route maps to 422 with `kind` field, same as existing `/generate`.
- **State lifecycle risks:** Article generation does not mutate `PendingTopic` status (remains `approved`); no new DB writes beyond existing `recordQuality` side-effect (reused pattern).
- **Access control (self-use model):** The route is JWT-gated; in the single-user self-hosted model any authenticated caller may generate articles for any topicId. This is a conscious scoping decision — if multi-user support is ever added, topicId-to-caller binding must be added at that point.
- **Metrics:** The route reuses `recordDraft()` which increments the shared generation counter in the quality dashboard. Article and simple draft generations will be counted together. Known limitation; a labeled counter can be added later.
- **API surface parity:** `GENERATE_DRAFT` background message flow is unchanged. Article generation uses **Option A** (background message, not direct HTTP): new `GENERATE_ARTICLE` message type added to the `RuntimeMessage` union; background handler routes it to `generateArticle()` in `lib/llm.ts`. SW keepalive timeout (messaging.ts) must cover the new message type.
- **Integration coverage:** Grounding gate (`verifyLinks`) must pass for article body just as for simple draft — the new assembler's section-based HTML must produce zero unsourced `<a href>` links.
- **Unchanged invariants:** Existing `/api/v1/drafts/generate`, `DraftSlots`, `assembleGossipDraft`, and `ContentDraft` shape are not changed. Simple draft generation remains the default path.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| LLM refuses or truncates `faqItems` array in structured output | Graceful fallback: if `faqItems` missing or non-array, treat as `[]` and emit FAQ section with placeholder |
| Title assembled from facts is routinely outside 25-35 chars (name too long) | Treat as `qualityWarning` (non-blocking), not hard error; editor adjusts manually |
| `json_schema` with nested `faqItems` array unsupported by some models | Two-pass retry (json_schema → json_object) already in `draft-gen.ts` pattern; mirror it |
| Extension routing approach | **Resolved**: Option A — background SW message (`GENERATE_ARTICLE`). SW keepalive timeout must be registered in messaging.ts. |
| Marketing-word blocklist too aggressive or too permissive | Emit as `qualityWarning` (not reject); editor can override tags; blocklist can be expanded in future |

## Documentation / Operational Notes

- `MARKETING_WORD_BLOCKLIST` in `article-tags.ts` is the authoritative list; future additions go here.
- The `<!-- section:X -->` HTML comment markers survive in JSON export (`assembleDraftJSON` emits `body` as-is) but are stripped by Markdown export (`htmlToPlain()` uses `/<[^>]*>/g` which matches HTML comments). This is expected: Markdown output is reader-facing prose, not editor markup.
- No new environment variables are needed; the route reuses `LLM_ENDPOINT`, `LLM_API_KEY`, `LLM_MODEL`.
- `loadPendingTopic(id)` (pending-store.ts:224) already provides fetch-by-ID; no new DB function needed.
- The `facts?: GossipFactsBlock` field already exists in `LlmDeps` (fetch-backoff.ts:6); the route sets it from `topic.facts`.

## Sources & References

- Related code: `packages/shared/src/post-assembler.ts`
- Related code: `packages/backend/src/services/draft-gen.ts`
- Related code: `packages/backend/src/app.ts` (`registerDraftRoutes`)
- Related code: `packages/extension/entrypoints/sidepanel/pending/GenerateConfirmDialog.tsx`
- Spec: 规范七（标题与正文撰写规范）+ 规范八（标签与关键词规范）— provided in planning request
