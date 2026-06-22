import { describe, expect, it } from "vitest";
import {
	assembleDraftJSON,
	assembleDraftMarkdown,
	assembleTopicsCSV,
	EXPORT_SCHEMA_VERSION,
	escapeCsv,
	type TopicForCSV,
} from "./export.js";
import type { ContentDraft } from "./types.js";

function draft(over: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: "draft_1",
		title: "标题",
		subtitle: "副标",
		description: "摘要",
		category: "2",
		tags: ["a", "b"],
		coverImageUrl: "",
		body: "<p>正文一</p><p>正文二</p>",
		status: "draft" as ContentDraft["status"],
		createdAt: "2026-06-22T00:00:00.000Z",
		...over,
	};
}

describe("escapeCsv (formula-injection defense)", () => {
	it("neutralizes leading = + - @ on string values with a quote prefix", () => {
		expect(escapeCsv("=1+1")).toBe("'=1+1");
		expect(escapeCsv("@cmd")).toBe("'@cmd");
		expect(escapeCsv("-2")).toBe("'-2");
	});
	it("does NOT neutralize numeric values (confidence/score columns)", () => {
		expect(escapeCsv(-2)).toBe("-2");
		expect(escapeCsv(0.6)).toBe("0.6");
	});
	it("quotes and doubles inner quotes when comma/quote/newline present", () => {
		expect(escapeCsv('a,"b"')).toBe('"a,""b"""');
		expect(escapeCsv("line\nbreak")).toBe('"line\nbreak"');
	});
	it("null/undefined become empty string", () => {
		expect(escapeCsv(null)).toBe("");
		expect(escapeCsv(undefined)).toBe("");
	});
});

describe("assembleTopicsCSV", () => {
	it("emits a single header row for an empty list", () => {
		const csv = assembleTopicsCSV([]);
		expect(csv).toContain("id,title,siteName");
		expect(csv.split("\r\n")).toHaveLength(1);
	});
	it("includes gossip fact columns and escapes injection in fact values", () => {
		const topic: TopicForCSV = {
			id: "t1",
			title: "标题",
			siteName: "站",
			sourceUrl: "https://s.com",
			confidence: 0.9,
			createdAt: "2026-06-22",
			facts: { 當事人: "=danger" },
		};
		const lines = assembleTopicsCSV([topic]).split("\r\n");
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain("'=danger");
	});
});

describe("assembleDraftJSON", () => {
	it("wraps the draft with schema version and null facts", () => {
		const out = assembleDraftJSON(draft(), null, "2026-06-22T00:00:00.000Z");
		expect(out.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
		expect(out.exportedAt).toBe("2026-06-22T00:00:00.000Z");
		expect(out.draft.id).toBe("draft_1");
		expect(out.gossipFacts).toBeNull();
	});
});

describe("assembleDraftMarkdown", () => {
	it("renders title, body paragraphs and tags; strips HTML", () => {
		const md = assembleDraftMarkdown(draft());
		expect(md).toContain("# 标题");
		expect(md).toContain("正文一");
		expect(md).toContain("正文二");
		expect(md).not.toContain("<p>");
		expect(md).toContain("**标签**: a, b");
	});
});
