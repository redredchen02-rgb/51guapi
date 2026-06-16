import type { ContentDraft } from "@51guapi/shared";
import { describe, expect, it } from "vitest";
import { computeSlotDiff } from "./draft-diff";

function draft(overrides: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: "id1",
		title: "T",
		subtitle: "S",
		category: "2",
		coverImageUrl: "",
		body: "<p>body</p>",
		tags: ["a", "b"],
		description: "desc",
		postStatus: "0",
		publishedAt: "2026-01-01",
		mediaId: "m1",
		status: "filled",
		createdAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("computeSlotDiff", () => {
	it("aiDraft 为 undefined → unknown:true，不报错", () => {
		const r = computeSlotDiff(undefined, draft());
		expect(r).toEqual({ changedSlots: [], totalSlots: 0, unknown: true });
	});

	it("aiDraft === finalDraft（无改动）→ changedSlots 空", () => {
		const d = draft();
		const r = computeSlotDiff(d, { ...d });
		expect(r.changedSlots).toHaveLength(0);
		expect(r.unknown).toBeUndefined();
	});

	it("title 改动 → changedSlots 包含 title", () => {
		const ai = draft({ title: "A" });
		const final = draft({ title: "B" });
		const r = computeSlotDiff(ai, final);
		expect(r.changedSlots).toContain("title");
		expect(r.changedSlots).not.toContain("body");
		expect(r.totalSlots).toBeGreaterThan(0);
	});

	it("tags 数组改动 → changedSlots 包含 tags", () => {
		const ai = draft({ tags: ["a"] });
		const final = draft({ tags: ["a", "b"] });
		const r = computeSlotDiff(ai, final);
		expect(r.changedSlots).toContain("tags");
	});

	it("tags 数组相同内容 → 不算变更", () => {
		const ai = draft({ tags: ["a", "b"] });
		const final = draft({ tags: ["a", "b"] });
		const r = computeSlotDiff(ai, final);
		expect(r.changedSlots).not.toContain("tags");
	});

	it("id/status/createdAt 不参与比较", () => {
		const ai = draft({
			id: "id1",
			status: "filled",
			createdAt: "2026-01-01T00:00:00Z",
		});
		const final = draft({
			id: "id2",
			status: "published",
			createdAt: "2026-06-01T00:00:00Z",
		});
		const r = computeSlotDiff(ai, final);
		expect(r.changedSlots).not.toContain("id");
		expect(r.changedSlots).not.toContain("status");
		expect(r.changedSlots).not.toContain("createdAt");
	});

	it("多字段同时改动 → changedSlots 全部列出", () => {
		const ai = draft({ title: "Old", body: "<p>old</p>" });
		const final = draft({ title: "New", body: "<p>new</p>" });
		const r = computeSlotDiff(ai, final);
		expect(r.changedSlots).toContain("title");
		expect(r.changedSlots).toContain("body");
	});
});
