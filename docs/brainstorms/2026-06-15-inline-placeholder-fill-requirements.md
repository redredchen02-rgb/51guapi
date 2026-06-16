---
date: 2026-06-15
topic: inline-placeholder-fill
---

# Fill Missing Facts via Structured Overlay + Re-assemble

> Renamed from "Inline 【待补】 Fill Editor". Document review (2026-06-15, 7 personas) found the original
> "labeled placeholders upstream + string-substitution" approach infeasible and unsafe; the approach below
> (operator fact overlay → re-run the pure assembler) was chosen instead. See Key Decisions.

## Problem Frame

When a topic lacks a fact (作品名, 集数, 制作, 漢化, 無修…), the draft ends up with the placeholder `【待补】` and the grounding gate hard-blocks authorized publish. The operator must supply the missing fact during review. Today this goes through a native `prompt()` doing a **global** `.replace(/【待补】/g, val)` over title and body (`BatchReviewPanel.tsx:126-139`).

Two code-verified defects:

1. **Wrong-value injection (correctness):** every `【待补】` receives the *same* string. `《【待补】》第【待补】集` gets the work name written into the episode slot too — into a real post. (`PLACEHOLDER` is a single global constant, so all occurrences are textually identical.)
2. **Fill does not unblock publishing (correctness):** the authorized-publish gate reads `assembledDraftSnapshot ?? item.draft` (`batch-orchestrator.ts:400`), preferring the snapshot. `patchBatchDrafts` updates only `draft`, never the snapshot, and only for `awaiting-approval` items (`batch.ts:212`). So a correct fill is still blocked by the stale `【待补】` in the snapshot, and gate-failed items' edits are ignored entirely. Worse, the orchestrator loop *skips* non-`awaiting-approval` items (`batch-orchestrator.ts:391`), so updating the snapshot alone does nothing for a gate-failed item.

Two further facts surfaced by review that reshape the fix:

3. **Placeholders are not uniformly assembler-emitted.** `assembleDraft` emits `【待补】` only in the **title** (missing 作品名); it **omits** missing body-fact rows entirely (deliberate: "缺的整行省略,不污染正文"). Bare `【待补】` in body prose is written by the **model** itself (instructed at `facts.ts:169/172`). Program code cannot retro-label text the model typed.
4. **The fact slots are 作品名/集数/制作/漢化/無修/简介** (`facts.ts`). There is no `原作` slot (alias of 制作) and no `连结` slot (URLs live inside 漢化/無修).

The fix must not weaken the anti-hallucination design (model never touches fact values; `post-assembler` injects them verbatim) or the anti-wash invariant (an AI rewrite must never launder a `【待补】` past the gate via the snapshot).

## Approach (chosen)

Operator fills the **missing facts as structured fields** (keyed to real `FactsBlock` slots). On commit, merge those facts into the item and **re-run the pure `assembleDraft(slots, mergedFacts)`** to regenerate `draft` and `assembledDraftSnapshot` together — no string surgery on existing HTML.

```
operator inputs:  作品名 [某作]   集数 [3]
        ↓
mergedFacts = { ...item.facts, 作品名:'某作', 集数:'3' }
        ↓
{ draft, snapshot } = assembleDraft(item.slots, mergedFacts)   ← pure, deterministic
        ↓
gate re-runs on the new snapshot → no 【待补】, links provenance-checked → publish proceeds
```

This fixes both defects at once (each slot is distinct; the snapshot is regenerated), and grounding invariants (verbatim injection, link-source check, escaping) hold *by construction* because the trusted assembler is the only writer.

## Requirements

**Structured fact overlay (the fix)**
- R1. The editor lets the operator fill the item's **missing/empty fact slots** as discrete fields keyed to the actual `FactsBlock` keys (作品名/集数/制作/漢化/無修/简介), each captioned by its slot name. No free-text placeholder substitution.
- R2. On commit, the system merges operator-provided facts into the item's facts and **re-runs `assembleDraft`** to produce a new `draft` and `assembledDraftSnapshot` together. It never string-substitutes into the existing draft/snapshot.
- R3. Operator-provided facts are **persisted on the item** (provenance = operator) so re-assembly is reproducible and the values are recorded as authoritative facts.

**Snapshot / gate semantics**
- R4. The snapshot is written **only** by the deterministic assembler fed original+operator facts. AI review/rewrite continues to never touch `assembledDraftSnapshot` (anti-wash preserved). No AI-authored draft string may be copied into the snapshot — even via the operator-commit path.
- R5. Gate detection must match **any `【待补…】` by its opening marker `【待补`** (prefix/regex match — fail-safe for unclosed/malformed/labeled/bare), through **one shared helper** that replaces every literal `.includes("【待补】")` site (`grounding-gate.ts:27,30`; `quality-gate.ts:73`, which must import the helper rather than hardcode the literal).
- R6. A gate-failed item re-enters the approval flow **only** by re-running the grounding gate on the updated snapshot and passing — never by a status flip on a "no slots left per the editor" heuristic. Any residual `【待补` (still-missing fact, or model-prose placeholder) keeps it gate-failed. This is a **new transition**, distinct from `retryFromGateFailed` (which regenerates from scratch and discards the fill).

**Input safety**
- R7. Operator-supplied fact values must be XSS-safe wherever rendered (preview, title, snapshot, Quill) — reuse the existing sanitize path; do not rely on the assembler's escaping alone for the title/preview. "Authoritative fact" governs *grounding trust*, not exemption from input sanitization.
- R8. Operator-supplied URL-bearing facts (漢化/無修 links) are validated (https scheme + sane format) before being accepted as sourced facts, so a pasted URL cannot bypass the unsourced-link gate.

**Editor UX**
- R9. The editor replaces the `prompt()` global-replace at `BatchReviewPanel.tsx:126-139`. It shows a **preview of the re-assembled title + body** before commit. Empty/whitespace-only inputs are trimmed and block commit for that slot with an inline message; cancel discards uncommitted input (confirm if any field was typed).

## Success Criteria
- Filling 作品名='某作' and 集数='3' on an item whose title was `《【待补】》第【待补】集` yields `《某作》第3集` — *distinct correct value per slot* — verifiable by test, with both `draft` and `assembledDraftSnapshot` updated.
- After all missing fact slots are filled, the gate re-runs on the new snapshot and authorized publish proceeds; with any `【待补` remaining, it still blocks.
- An AI rewrite that removes a `【待补】` from the visible draft still fails the gate (snapshot regenerated only from facts, unchanged by AI) — existing anti-wash tests stay green; add a test that an AI-rewritten value never reaches the snapshot through the operator-commit path.
- A labeled, bare, or unclosed `【待补` variant is detected by the shared helper; none reaches a published post.
- An operator value like `<img onerror=…>` as 作品名 is neutralized in preview/title/snapshot.

## Scope Boundaries (non-goals)
- **No model-prompt change.** The model still writes bare `【待补】` in prose; we do **not** introduce labeled placeholders or change `facts.ts` generation instructions (avoids LLM-format-reliability risk and few-shot training-data contamination).
- **Model-prose `【待补】` (narrative, e.g. zero-fact "通篇【待补】" drafts) is out of this editor's scope.** Those are resolved by supplying facts and **regenerating** (`retryFromGateFailed`), not by hand-editing prose; the gate keeps blocking until clear.
- **No gate-logic change** — detection *format/predicate* only (R5).
- **No batch state-machine redesign** beyond the one new gate-failed→awaiting-approval transition (R6).
- **No storage-format migration** — detection is prefix-tolerant, so existing stored bare `【待补】` keeps working without a data migration.

## Key Decisions
- **Fact overlay + re-assemble** (chosen over string-substitution and over upstream labeled placeholders). Rationale: review proved labeled placeholders can't cover model-emitted prose tokens and would require a risky model-prompt change; string-substituting into the snapshot reproduces the same wrong-target bug class and breaks link-provenance. Re-running the pure assembler makes per-slot correctness and grounding invariants hold by construction, and resolves 原作/连结 routing for free.
- **Operator facts are authoritative and update the snapshot via the assembler** (not via copying draft strings). Rationale: operator-provided facts are the same trust class the assembler already injects verbatim; routing them through the assembler (not a raw string write) keeps anti-wash structural, not procedural.
- **Fail-safe detection on the `【待补` opening marker.** Rationale: a closing-bracket-anchored match misses unclosed/malformed tokens — a fail-open on the core anti-hallucination gate.

## Dependencies / Assumptions
- Coordinated change across `shared/` (assembler/facts/gates/shared detection helper) and `extension/` (review UI, batch state + new transition). `shared` must rebuild `dist/` before extension type-checks.
- Existing anti-wash tests (`batch-orchestrator.test.ts`) and gate tests are the regression guard for R4/R5.
- Assumes `assembleDraft` is callable with an item's original slots + merged facts at review time (item must retain `slots`/`facts`, not just the rendered draft) — **verify in planning**.

## Outstanding Questions

### Deferred to Planning
- [Affects R2/R3][Technical] Does the persisted `BatchItem` retain enough (`slots` + `facts`) to re-run `assembleDraft` at review time, or must generation persist them? This gates the whole approach.
- [Affects R6][Technical] Exact new transition (`gate-failed → awaiting-approval` preserving the re-assembled draft) vs. adapting `retryFromGateFailed`; note the orchestrator loop skips non-`awaiting-approval` items.
- [Affects R5][Technical] Final shared detection predicate and audit of every literal `【待补】` call site (`grounding-gate.ts:27,30`, `quality-gate.ts:73`, `PLACEHOLDER` consumers, fillers/grounding tests).
- [Affects R9][Design] Editor host — inside `ItemCard` (existing `onDraftChange`/`draftOverrides` seam) vs. a dedicated "补全缺失事实" block; and how it interacts with the existing per-item draft inline-edit (U7) to avoid two write paths into draft/snapshot.
- [Affects scope][Technical] Single-item (non-batch) publish path (`publish-orchestrator.ts`) — does it read `assembledDraftSnapshot` the same way and need the same fix?

## Next Steps
→ `/ce:plan` for structured implementation planning
