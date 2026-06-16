---
date: 2026-06-15
topic: observability-drift-firstflight-r3
focus: open exploration — round 3 (after R2 batch-reliability shipped in full)
---

# Ideation: Observability, Drift & First-Flight — Round 3

## Codebase Context

**Project shape:** TS pnpm monorepo. Chrome MV3 extension (WXT + React 19) automating AI-assisted batch posting to 51acgs.com. Three-world model: background SW (LLM/gate, sole API-key holder) ↔ isolated content (DOM fill, never self-authorizes) ↔ main-world quill-bridge (only `window.Quill`). Backend: Fastify 5 (JWT, batch sync, scraper/topic pipeline, SSRF allowlist). `shared/`: pure logic. Version 0.2.0.0.

**R2 (2026-06-04) shipped IN FULL — do NOT re-propose:** storage.watch live batch feed; History/trajectory panel + `verifyTrajectory` chain badge; per-field fill-skip status board; `createHandlers` factory + bg unit tests; `evaluateGate` TOCTOU `Promise.all` fix; `fillTombstone` protocol + SW startup quarantine scan; DryRunReport storage+panel; `RETRY_BATCH_ITEM` single-item retry; concurrent draft generation (pool of 3 + serial mutex); quarantine bulk release; connection-test button; slotDiff in trajectory; LLM 429/5xx backoff (**backend only**); apiFetch 401→clearToken; injectable fetchFn seams. All 7 R2 survivors + 5 bonus confirmed DONE by code audit.

**Deliberately rejected before (still out):** parallel-LLM-at-scale, auto-approve fast-path, multi-site registry, direct-API publisher, selector self-healing via LLM.

**Open gaps (R3 territory):**

- **Observability**: `/metrics` has only 6 flat counters — no latency percentiles, no publish funnel. Most clearly-flagged gap.
- **NORTH STAR**: never published a single real post (first-flight). Code ready; only irreversible operator steps remain. `docs/runbooks/first-flight-runbook.md`.
- **Backend-drift blind spot**: e2e proves correctness only vs a FROZEN fixture; drift discovered passively (fill breaks → re-scrape → contract red). No canary. Re-scrape touches real login = high-risk. Drift already seen: new `cover_url` hidden field, `tags[]` grew, brand "海角社区".
- **Injection=gate surface** host literal lives in **4 places** (content.ts matches, quill-bridge matches, wxt.config DEFAULT_HOSTS, safety-gate authorizedHosts) — sync footgun.
- **Captured-but-unused signal**: slotDiff / hasManualEdit on every trajectory record, never aggregated.
- **Correctness footgun**: 【待补】 fill uses native `prompt()` + `.replace(/【待补】/g, val)` GLOBAL replace — distinct placeholders all get the same value (`BatchReviewPanel.tsx:128`).
- Large React components untested (`TodayBatchView` ~786, `Settings` ~613, `PendingTopicsView` 553); known flaky `PendingTopicsView` scraper-trigger test (async race).
- off-mode trajectory naming misleading (`fill-completed` reused for gateway-blocked; off-mode kill records no trajectory).
- Extension `lib/llm.ts` has no backoff (backend only); pool-of-3 makes 429s likelier on the unprotected path.

**Constraints:** MV3 SW ~30s lifecycle; MV3 FileList read-only (cover image can't auto-upload, but `cover_url` field now exists); single operator; comments/docs Chinese, commits English; biome.

## Ranked Ideas

### 1. Inline 【待补】 fill editor (kill the prompt() global-replace footgun)
**Description:** Replace the native `prompt()` + `.replace(/【待补】/g, val)` global replace at `BatchReviewPanel.tsx:128` with an inline per-placeholder editor: show each placeholder's surrounding sentence, let each take a distinct value (work name ≠ episode), and preview the assembled result before commit. Grounding-gate already distinguishes title-vs-body 【待补】 — the fill path should too.
**Rationale:** This is a correctness bug, not just UX: today multiple distinct placeholders silently receive the SAME string and that goes into a real post. It sits on the most-traveled review path (every gate-blocked draft).
**Downsides:** A small editor component; needs to handle the multi-placeholder layout cleanly.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Explored (brainstorm 2026-06-15)

### 2. Publish funnel + latency percentiles in /metrics (with honest trajectory statuses)
**Description:** Expand `services/metrics.ts` from 6 flat counters into a stage funnel (generated → grounding-pass/block → dry-run → authorized fill → confirmed/quarantined) plus p50/p95 latency histograms for LLM-gen and fill. Source it from trajectory lifecycle. **Prerequisite folded in:** give gateway-blocked and off-mode-killed their own first-class trajectory statuses (stop overloading `fill-completed`; always record off-mode kills) so the funnel doesn't lie.
**Rationale:** The single most clearly-flagged gap. Six counters can't answer "where do posts die?" — exactly the diagnosis needed with a solo operator and zero real posts. Every later quality question plugs into the same funnel.
**Downsides:** Honest-status change touches trajectory schema; needs a migration note for existing local records. Prometheus histogram text format adds surface.
**Confidence:** 88%
**Complexity:** Medium
**Status:** Unexplored

### 3. Read-only backend-drift canary (field names + booleans, never literals, never submit)
**Description:** Operator-triggered probe that opens the real authorized form, enumerates ONLY field `name`s and presence/is-Quill booleans for each `DEFAULT_FIELD_MAPPING` selector, and diffs that boolean vector against the frozen fixture's expected set. Surfaces "drift: cover_url present / tags[] cardinality changed" in the side panel. Never reads values, never submits (uses the established indirect-verify technique; claude-in-chrome redacts inline JS anyway).
**Rationale:** Inverts the most-cited blind spot from passive (fill breaks in prod) to active, WITHOUT the high-risk full re-scrape that touches login state. Drift already bit the project (cover_url, tags[], brand rename).
**Downsides:** Needs a safe trigger path against the live form; must be opt-in and clearly read-only.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 4. Single source of truth for the injection=gate host surface
**Description:** Hoist the authorized-domain list into one shared module (e.g. `shared/src/authorized-hosts.ts`) consumed by content.ts matches, quill-bridge matches, wxt.config DEFAULT_HOSTS, AND safety-gate authorizedHosts. Add a build/test assertion that all four resolved sets are identical — fail the build on drift.
**Rationale:** The 4-place sync is the highest-leverage footgun in the codebase (called out repeatedly in CLAUDE.md). A drifted match means silent non-injection or injecting where the gate doesn't expect. One constant + one equality test kills the whole error class and makes the eventual prod-domain cutover a one-line change.
**Downsides:** WXT/MV3 manifest generation reads config at build time — must confirm the shared import resolves in that context.
**Confidence:** 85%
**Complexity:** Low
**Status:** Unexplored

### 5. slotDiff → quality dataset + edit-rate metric (replace asserted quality with measured)
**Description:** Aggregate the already-captured slotDiff / hasManualEdit across batches into a structured per-slot dataset: direct-send rate (% published with zero edits), per-slot edit frequency, and hallucination-edit rate (edits near injected facts). Surface via a /metrics-fed report or backend JSON endpoint. Demote the gameable hardcoded slang-word check in `quality-gate.ts checkCommunityTone` to a soft hint.
**Rationale:** The diff data is captured but thrown away after display. Operator edits are ground truth about draft quality; the slang heuristic (≥2 of 嗨嗨/安利/宝藏…) rewards keyword-stuffing. Closing the loop turns prompt tuning from vibes into data, and compounds for free with every batch.
**Downsides:** Needs a transport from local trajectory → backend (reuse withBackendSync seam). "Hallucination-edit rate" heuristic needs careful definition.
**Confidence:** 78%
**Complexity:** Medium
**Status:** Unexplored

### 6. First-flight readiness: mechanical preflight self-test + guided one-post wizard
**Description:** Two-part. (A) A `pnpm preflight` / backend route that mechanically verifies every 🟢 reversible runbook item (CORS id match, no API key in bundle, fail-closed boots, dry-run produces a green DryRunReport over the fixture, trajectory chain verifies, metrics increment) and prints one red/green verdict. (B) An in-sidepanel first-flight wizard that forces a successful dry-run + grounding-gate pass on the SAME snapshot, shows the exact host to be authorized, unlocks authorized for ONE post, then auto-reverts to dry-run.
**Rationale:** The north-star blocker is the never-run irreversible first publish. Part A collapses the runbook's verifiable half into a deterministic green bar; Part B makes the irreversible step the last gated action and structurally prevents out-of-order mistakes — without touching the human approval gate or zero-submit invariant.
**Downsides:** Two deliverables; the wizard's auto-revert needs careful state handling. Could be split into two efforts.
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 7. Characterization tests for the largest untested React views via reducer extraction
**Description:** Extract `TodayBatchView` (~786 lines) batch/approval/retry state transitions into a pure reducer; unit-test the reducer exhaustively + a thin render smoke test. Apply the same pattern to `Settings.tsx` (~613). Separately, fix the flaky `PendingTopicsView` scraper-trigger test deterministically (expose a settle signal, not sleeps) and codify the async-settle helper for reuse.
**Rationale:** `BatchReviewPanel.test.tsx` (686 lines) proves the team values this, yet the biggest views are bare. A pure reducer is testable, shrinks the component, and gives every future batch-flow change a cheap regression net. A flaky test trains the operator to ignore red — corrosive for a test-guarded publishing tool.
**Downsides:** Reducer extraction is a real refactor; risk of behavior drift during extraction (mitigated by writing characterization tests first).
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Extension-side LLM backoff via shared policy | Real but incremental quick-win; smallest strategic payoff. Worth doing, but folds into idea #2/#5 plumbing work rather than standing alone. |
| 2 | grounding-gate tamper-evident snapshot hash | Protects a real invariant, but a regression TEST asserting "gate evaluates pre-rewrite snapshot" achieves most of it; runtime hashing is over-engineering for a single operator. |
| 3 | Cover-image manual-upload handoff (nudge + reveal file) | MV3 FileList read-only makes this inherently manual; value is real but narrow. Partially covered by #5's cover_url soft check. |
| 4 | cover_url presence soft-warning in DryRunReport | Good but small; absorb as one check inside #2's funnel / #6's preflight rather than a standalone idea. |
| 5 | degrade-stats threshold early-warning banner | Overlaps #3 (drift canary); runtime degradation is a weaker, noisier signal than a structural probe. |
| 6 | Dry-run LLM-vs-injected-fact color diff | Nice trust-surfacing UX but marginal vs #1 + DryRunReport already shipped; defer. |
| 7 | Resume-friendly batch session cursor | storage.watch + tombstone recovery (R2) already cover the durability need; incremental. |
| 8 | Automate fixture re-scrape redaction script | Valuable dev-safety tooling, but lower frequency than #3 and doesn't reduce the live-login risk itself. |
| 9 | Auto-sediment docs/solutions from session diff | Knowledge-compounding but meta/process tooling, not product pain; better as a workflow skill than an ideation survivor. |
| 10 | Trajectory metrics export endpoint (standalone) | Merged into #2/#5 — it's the transport, not a separate idea. |
| 11 | Rename tier vocabulary (fill-only/rehearse/publish) | The honest-status half is the load-bearing part and is folded into #2; a full vocab rename is churn for marginal clarity. |

## Session Log
- 2026-06-15: R3 ideation — 35 raw ideas (5 frames × 7), ~24 unique after dedup/synthesis, 7 survived adversarial filtering. Grounded on a fresh code audit confirming all 7 R2 survivors + 5 bonus features shipped.
- 2026-06-15: Selected idea #1 (inline 【待补】 fill editor) → handed off to ce:brainstorm.
