---
date: 2026-06-04
topic: batch-reliability-observability-r2
focus: open exploration — round 2 (after feat/batch-reliability-ux)
---

# Ideation: Batch Reliability & Observability — Round 2

## Codebase Context

**Project shape:** TypeScript MV3 Chrome Extension (WXT + React 19). Automates batch posting to 51acgs.com.

**Architecture:**

- Background SW (LLM/orchestration) ↔ Isolated content script (DOM fill) ↔ Main world Quill bridge
- Batch state machine: pure functions in `lib/batch.ts`, effects injected via `BatchOrchestratorDeps` in `lib/batch-orchestrator.ts`
- Storage: `lib/storage.ts` with fail-closed reads; trajectory chain with FNV-1a hash in `lib/trajectory.ts`

**Already implemented (do NOT re-propose):**

- U1 Quill degraded badge, U2 selector drift gate, U3 quarantine release context
- U4 persistent topic dedup, U5 fixture drift script, U6 textarea dedup fix, U7 draft inline edit

**Known gaps going into this round:**

- Batch progress invisible during run (no storage.watch subscription on side panel)
- Publish history has no UI (trajectory.ts fully implemented, zero UI)
- Fill-skip paths are silent (skipped fields never shown, only degraded badge)
- Crash recovery state machine incomplete (recoverBatch passive only, no startup notification)
- Background wiring has no unit tests; TOCTOU in `evaluateGate` documented as P2
- dry-run returns `ok:true` with zero fill-result output

**Constraints:**

- MV3 SW ~30s lifecycle → no scheduled auto-publish, no parallel LLM generation at scale
- MV3 FileList read-only → no cover image auto-upload
- Zero-submit invariant (third-party platforms); own site already unlocked
- Excluded: LLM auto-retry, selector self-healing via LLM, multi-site registry, direct API publisher

---

## Ranked Ideas

### 1. Batch Progress Live Feed

**Description:** Background already calls `save(batch)` after every state transition. Side panel subscribes to `chrome.storage.onChanged` (storage.watch) on `local:batch` and re-renders per-item status chips (queued→generating→filled→dispatched→confirmed) without polling. A progress bar derived from `batchSummary()` shows overall completion. Debounce rendering to avoid excessive React re-renders on large batches.
**Rationale:** Batch progress invisibility is the most frequently felt pain point. The data is already written to storage on every transition — only the push/subscribe path is missing. This converts a trust-eroding black box into an auditable live feed.
**Downsides:** `storage.onChanged` fires once per item per transition; a 20-item batch triggers ~40 events. Requires debounced rendering.
**Confidence:** 90%
**Complexity:** Low
**Status:** Unexplored

### 2. Publish History Panel (Trajectory UI)

**Description:** Add a "History" tab to the side panel. Read `local:trajectory` via `getTrajectory()`, render records newest-first: topic, status badge, publish URL (clickable), timestamp, fill-degraded count. Run `verifyTrajectory()` once on load; show a ✓ / ⚠ chain-integrity badge. `rollbackTargets()` rows get a "查看帖子" CTA. Paginate at 20 records.
**Rationale:** `trajectory.ts` has a fully-designed auditable hash chain, rollback targets, and scrubbed snapshots — but not a single line of UI reads it. Published posts are invisible after batch completion, making post-publish QA and accidental-duplicate detection manual.
**Downsides:** Large trajectory stores need pagination. No write path — read-only UI.
**Confidence:** 95%
**Complexity:** Low
**Status:** Unexplored

### 3. Fill-Skip Full Status Board

**Description:** When a batch item is expanded in the approval card, show a three-column status table for all fields: filled (green) / skipped (amber) / degraded (red), with the `note` string for each skipped or degraded field (e.g., "category 无匹配选项: 2"). U1 only shows a degraded badge — this exposes the silent `skipped` path as well. Shown before the user clicks Approve.
**Rationale:** `BatchItem.fillResults` is already written with three-state `FieldFillResult.status` and notes. The data exists; only the UI rendering of `skipped` is missing. Users currently approve without knowing which fields silently received no value.
**Downsides:** If all fields fill cleanly the table adds visual noise. Should collapse by default.
**Confidence:** 85%
**Complexity:** Low
**Status:** Unexplored

### 4. Background Wiring Unit Tests + TOCTOU evaluateGate Fix (Bundled)

**Description:** (A) Extract `handleRunBatch`, `handleApproveBatch`, `handleKillBatch`, `handleReleaseQuarantine`, `handlePublish` from `background.ts` into a `createHandlers(deps)` pure factory — same adapter-injection pattern proven in `lib/batch-orchestrator.ts`. Write vitest tests covering tab-drift, content-unreachable, null-tab, and SW crash paths. (B) Fix `evaluateGate`: merge `getSafetyMode`, `getAuthorizedHosts`, and `resolveTabHost` into a single `Promise.all` call, eliminating the two-read TOCTOU window where the tab can navigate between the first and second async reads.
**Rationale:** `background.ts` is the trust boundary for every safety invariant (gate eval, dispatched wiring, quarantine) yet has zero unit tests. The TOCTOU issue is documented at P2. The adapter-injection pattern is proven in `lib/` — applying it here completes test coverage parity.
**Downsides:** Refactoring the handler layer requires care around browser API boundaries. The TOCTOU fix changes async sequencing in the hot publish path.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 5. Crash Recovery Hardening: Tombstone Protocol + SW Startup Quarantine Notification (Bundled)

**Description:** (A) Before each `sendFill` dispatch, write `local:fillTombstone:{itemId}` to storage; clear it only on confirmed fill ACK. On SW restart, scan for residual tombstones — these are items that were dispatched but for which `recoverBatch` has no record (SW died before any `markDispatched` write). Mark them `needs-human-verification` with reason `tombstone-no-ack`. (B) In `defineBackground`, after the SW wakes, proactively call `getBatch()` and if any `needs-human-verification` items exist, send a `runtime.sendMessage` to the side panel triggering a persistent Quarantine Inbox banner: "N posts in uncertain state — verify on site before releasing."
**Rationale:** `recoverBatch` only catches `dispatched` items where the state was written before the crash. A tombstone catches the earlier failure mode: SW died between `markDispatched` write and the next iteration. Without a startup notification, quarantined items silently accumulate and block future batches on the same topics.
**Downsides:** Tombstone adds one storage write to the hot fill path. Startup notification requires side panel to be open (or use chrome.notifications as fallback).
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 6. Dry-Run Fill Report

**Description:** In `SafetyMode='dry-run'`, `approveBatch` already calls `sendFill` and receives `fillResults` (these are produced before `orchestratePublish`). Currently `batch-orchestrator.ts` discards them at `if (r.dryRun) return`. Instead, collect per-item `fillResults` + draft field values and store them in `local:dryRunReport`. Side panel renders a structured report: for each item, show field-by-field fill status (filled/skipped/degraded) and what value would have been written. This replaces `ok:true` with a full pre-publish diagnostic.
**Rationale:** `dry-run` is supposed to be the safe pre-flight mode but currently tells the user nothing. The fill results are already computed in dry-run — they're just thrown away. Exposing them transforms dry-run from a no-op into the most useful pre-publish verification path available.
**Downsides:** Requires side panel DryRunReport render path. `local:dryRunReport` is transient (overwritten each dry-run).
**Confidence:** 88%
**Complexity:** Medium
**Status:** Unexplored

### 7. Batch Error-Item Granular Retry (RETRY_BATCH_ITEM)

**Description:** Add `RETRY_BATCH_ITEM` message type. Handler in `background.ts` transitions a single `error` or `aborted` item back to `queued` (or introduce a new non-TERMINAL `retriable-error` status), then re-runs only that item's generate → filled → awaiting-approval pipeline. All other items in the batch remain untouched. The existing `transition` guards in `batch.ts` prevent invalid state changes.
**Rationale:** A single LLM rate-limit or network blip today forces the user to discard and recreate the entire batch — including re-doing already-approved items. Granular retry recovers partial batch failures without discarding confirmed items.
**Downsides:** Need to decide whether `error` exits the TERMINAL set entirely or add a parallel `retriable-error` status to preserve the terminal guarantee for non-retriable errors (e.g., auth failure).
**Confidence:** 82%
**Complexity:** Medium
**Status:** Unexplored

---

## Rejection Summary

| #   | Idea                                             | Reason Rejected                                                               |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | Parallel LLM generation (concurrency semaphore)  | MV3 SW ~30s lifecycle — concurrent LLM calls race against SW termination      |
| 2   | LLM streaming timeout budget                     | Scope of LLM lifecycle management; LLM auto-retry category already excluded   |
| 3   | LLM JSON partial-recovery extractor              | Same excluded category as LLM auto-retry                                      |
| 4   | Background pre-warm (two batches simultaneously) | MV3 SW lifecycle cannot span two sequential user review sessions              |
| 5   | Approval-free fast-path (auto-approve)           | Removes human safety gate — the primary trust mechanism for a publishing tool |
| 6   | Side panel BroadcastChannel mutex                | Single-operator use; over-engineering for a scenario that won't occur         |
| 7   | Batch chunker for 100+ topics                    | YAGNI — current pain points are about visibility and recovery, not scale      |
| 8   | Tab navigation fill suspend/resume               | Complex observer must distinguish intentional from programmatic navigation    |
| 9   | SW resurrection tombstone (standalone)           | Merged into idea #5 (crash recovery hardening)                                |
| 10  | Power-user cross-run batch diff                  | No operational value for single operator; sample size too small for trends    |
| 11  | publishedTopics topic heatmap / fuzzy dedup      | Adds NLP complexity; exact dedup covers real use case                         |
| 12  | Field mapping live editor with selector probe    | Enormous scope relative to single-operator use                                |
| 13  | Batch completion health trend report             | Statistical trends meaningless at current sample volumes                      |
| 14  | Per-item prompt template overrides               | Multiplies prompt surface area; debugging LLM output becomes intractable      |
| 15  | Topic CSV import with dedup preview              | YAGNI for current batch sizes; textarea sufficient                            |
| 16  | Published-topics export/import                   | Single-operator cross-device use case; over-engineering                       |
| 17  | Trajectory replay as dry-run smoke test          | Production data mixed into test path; safety boundary unclear                 |
| 18  | Synthetic fixture generator from field-mapping   | Dev tooling, not user-facing; fixture-contract.test.ts already covers this    |
| 19  | Batch replay from trajectory records             | Risks re-publishing already-published content; too dangerous                  |
| 20  | Pre-commit hook via simple-git-hooks             | Developer hygiene, not user pain point                                        |
| 21  | Structured sanitizeBody diff at approval         | Overlap with #3 (fill-skip board); higher complexity for marginal added value |
| 22  | Single-item draft re-generation                  | Complex partial-regeneration path; draft inline edit (U7) covers the use case |
| 23  | Quill bridge readiness handshake                 | Low-frequency edge case; exponential back-off adds state machine complexity   |

---

## Session Log

- 2026-06-04: Round 2 ideation — 48 raw ideas generated (6 frames × 8), 36 unique after dedup, 7 survived adversarial filtering
