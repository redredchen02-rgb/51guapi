---
date: 2026-06-04
topic: open-exploration
focus: open-ended
---

# Ideation: 51publisher 開放探索

## Codebase Context

- TypeScript + React Chrome Extension (MV3), WXT framework, pnpm
- Purpose: auto fill & post to 51acgs.com admin panel (layui + Quill 2.0.2)
- Architecture: side panel UI ↔ background SW ↔ content scripts (isolated + main world)
- Key lib: fillers.ts, publish-orchestrator.ts, field-mapping.ts, trajectory.ts, batch.ts
- Pain points: silent field skips, one-at-a-time UX, in-memory dedup resets on SW restart, cover image manual, Quill tier-② degradation not surfaced
- Trajectory + crash recovery already implemented; selector drift check exists but manual-only

## Ranked Ideas

### 1. Draft Inline Edit Before Batch Approval

**Description:** During batch awaiting-approval phase, show editable fields (title/tags/category/body preview) in side panel instead of binary approve/reject.
**Rationale:** BatchItem.draft: ContentDraft already stored at this state; markFilled() accepts a new draft. Turns binary reject/accept into a fast correction loop, reducing aborted items.
**Downsides:** Needs draft state round-trip from background to side panel; long body editing in a panel is awkward (needs truncation/expand).
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 2. Persistent Topic Deduplication Store

**Description:** Persist published/quarantined topics to chrome.storage.local. Currently quarantinedTopics() is in-memory only — SW restart clears it, allowing same topic to republish.
**Rationale:** Real correctness bug. storage.ts has existing CRUD; filterReentrantTopics() already has dedup logic, just needs persistent backing store.
**Downsides:** Store grows unbounded over time; needs pruning (e.g. max 1000 or TTL).
**Confidence:** 90%
**Complexity:** Low
**Status:** Unexplored

### 3. Batch Topic Import from Newline Text

**Description:** Replace one-by-one topic entry with a textarea that accepts newline-separated topics, parsed + deduped before RUN_BATCH.
**Rationale:** RUN_BATCH already accepts topics: string[]. The entire constraint is in the UI. Operators typically prepare topic lists in spreadsheets — paste-and-parse removes O(n) manual entry.
**Downsides:** Essentially no downsides; <50 lines of UI code.
**Confidence:** 95%
**Complexity:** Low
**Status:** Unexplored

### 4. Proactive Selector Drift Gate (weakened)

**Description:** When user clicks "Approve" or "Start Fill", run checkSelectorDrift() first. If KEY_SELECTORS have gaps, show a blocking warning before the fill starts.
**Rationale:** Currently drift discovered only after fill produces empty fields. CHECK_SELECTORS message already exists. Weakened from "always-on background probe" to "one-shot on approval/fill action" — no extra round-trip on the happy path.
**Downsides:** fillDraft() already returns per-field skipped status; this gate is slightly redundant but fires earlier (before the batch commitment).
**Confidence:** 80%
**Complexity:** Low
**Status:** Unexplored

### 5. Quill Tier-② Degradation Alert

**Description:** When pasteIntoQuill() falls to tier ② (direct innerHTML, no Quill delta), propagate PasteResult.degraded into FieldFillResult.status and surface in the panel as "降級填充：格式可能丟失".
**Rationale:** Tier ② sets innerHTML without Quill's serializer, so rich-text formatting is stripped on POST. Currently the degraded flag is set but never reaches the UI.
**Downsides:** Alerts on root cause (window.Quill unavailable) but doesn't fix it.
**Confidence:** 90%
**Complexity:** Low
**Status:** Unexplored

### 6. Quarantine Release with Context

**Description:** When a batch item enters needs-human-verification, show fill result summary + publishUrl (if any) + failure reason alongside the Release button.
**Rationale:** Data already in trajectory records. Operator currently has no way to know if the post actually published before deciding to re-publish or discard.
**Downsides:** Low-frequency scenario (requires SW crash mid-publish); limited ROI.
**Confidence:** 80%
**Complexity:** Low
**Status:** Unexplored

### 7. Fixture Freshness Watcher (weakened)

**Description:** Add pnpm check:fixture-drift script: reads KEY_SELECTORS from DEFAULT_FIELD_MAPPING, checks if each selector exists in tests/e2e/fixtures/\*.html, reports mismatches.
**Rationale:** Docs explicitly call drift "passively discovered." Static comparison (no live-site fetch needed) gives developers a fast signal when fixture HTML diverges from field mapping.
**Downsides:** Only catches divergence between fixture and mapping; doesn't detect real-site changes. Weakened from the original CI-fetch version.
**Confidence:** 75%
**Complexity:** Low
**Status:** Unexplored

## Rejection Summary

| #   | Idea                                | Reason Rejected                                                                                           |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | LLM Draft Validation + Auto-Retry   | Auto-retry masks broken prompt; silently burns tokens instead of fixing root cause                        |
| 2   | Tag Vocabulary Cache                | Stale cache produces false-positive mismatches; existing 'degraded' result already surfaces real failures |
| 3   | Zod Schema for ContentDraft         | Zod throws by default; LLM parser needs graceful degradation not exceptions                               |
| 4   | Cover Image Full Auto-Upload        | MV3 content scripts cannot programmatically set input.files (FileList is read-only per spec)              |
| 5   | Scheduled Publish via chrome.alarms | SW window ~30s; batch loop cannot complete within alarm window                                            |
| 6   | Per-Item LLM Retry                  | Manual batch re-run is sufficient; retry adds complexity >> value                                         |
| 7   | Selector Self-Healing via LLM       | LLM-proposed selectors may silently target wrong elements — worse than explicit failure                   |
| 8   | Multi-Site Recipe Registry          | YAGNI: one site, one operator                                                                             |
| 9   | Server-Side Headless Publisher      | Infrastructure cost too high for current scope                                                            |
| 10  | LLM-as-Orchestrator                 | Removes human review of batch; requires tool-use API + prompt engineering                                 |
| 11  | Direct API Publisher                | Bypassing DOM loses selector drift detection and fill verification                                        |
| 12  | Diff-Based Idempotent Sync          | Admin API for listing posts may not exist                                                                 |

## Session Log

- 2026-06-04: Initial open ideation — 6 frames × 8 ideas = 48 raw, ~34 after dedup+synthesis, 7 survived adversarial filter
