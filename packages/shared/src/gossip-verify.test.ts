import { describe, expect, it } from "vitest";
import type { GossipFactsBlock } from "./gossip-facts.js";
import { computeContentFingerprint, isWithinWindow } from "./gossip-verify.js";

function facts(over: Partial<GossipFactsBlock> = {}): GossipFactsBlock {
	return {
		當事人: null,
		事件摘要: null,
		起因: null,
		經過: null,
		結果: null,
		來源連結: null,
		發生時間: null,
		熱度標籤: null,
		...over,
	};
}

describe("computeContentFingerprint", () => {
	it("is deterministic for identical facts", () => {
		const f = facts({ 當事人: "甲", 事件摘要: "x" });
		expect(computeContentFingerprint(f)).toBe(computeContentFingerprint(f));
	});
	it("differs when a fingerprint field changes", () => {
		const a = computeContentFingerprint(facts({ 當事人: "甲" }));
		const b = computeContentFingerprint(facts({ 當事人: "乙" }));
		expect(a).not.toBe(b);
	});
});

describe("isWithinWindow", () => {
	// shared 内禁用 Date.now —— now 由调用方注入(此处用固定时间戳)。
	const now = Date.parse("2026-06-22T00:00:00.000Z");
	it("returns unknown when publishedTime is missing or unparseable", () => {
		expect(isWithinWindow(null, 30, now).unknown).toBe(true);
		expect(isWithinWindow("not-a-date", 30, now).unknown).toBe(true);
	});
	it("does not filter when windowDays is null", () => {
		const r = isWithinWindow("2020-01-01T00:00:00.000Z", null, now);
		expect(r.ok).toBe(true);
		expect(r.unknown).toBe(false);
	});
	it("ok within the window, not ok outside it", () => {
		expect(isWithinWindow("2026-06-21T00:00:00.000Z", 30, now).ok).toBe(true);
		expect(isWithinWindow("2026-01-01T00:00:00.000Z", 30, now).ok).toBe(false);
	});
});
