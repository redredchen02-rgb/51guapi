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
	it("O2: header includes status column", () => {
		const csv = assembleTopicsCSV([]);
		expect(csv).toContain("status");
	});
	it("O2: status field appears in data row", () => {
		const topic: TopicForCSV = {
			id: "t2",
			title: "t",
			siteName: "s",
			sourceUrl: "https://s.com",
			confidence: 0.5,
			status: "approved",
			createdAt: "2026-06-23",
			facts: {},
		};
		const [header, row] = assembleTopicsCSV([topic]).split("\r\n");
		const statusIdx = header.split(",").indexOf("status");
		expect(statusIdx).toBeGreaterThan(-1);
		expect(row.split(",")[statusIdx]).toBe("approved");
	});
	it("O2: missing status becomes empty cell", () => {
		const topic: TopicForCSV = {
			id: "t3",
			title: "t",
			siteName: "s",
			sourceUrl: "https://s.com",
			confidence: 0.5,
			createdAt: "2026-06-23",
			facts: {},
		};
		const [header, row] = assembleTopicsCSV([topic]).split("\r\n");
		const statusIdx = header.split(",").indexOf("status");
		expect(row.split(",")[statusIdx]).toBe("");
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
	it("O2: includes all ContentDraft fields verbatim", () => {
		const d = draft({
			coverImageUrl: "https://img.example.com/cover.jpg",
			tags: ["x"],
		});
		const out = assembleDraftJSON(d, null, "2026-06-22T00:00:00.000Z");
		expect(out.draft.coverImageUrl).toBe("https://img.example.com/cover.jpg");
		expect(out.draft.tags).toEqual(["x"]);
		expect(out.draft.category).toBe("2");
		expect(out.draft.status).toBe("draft");
	});
	it("O2: gossipFacts passed through verbatim", () => {
		const facts = {
			當事人: "明星A",
			來源連結: "https://src.com",
			事件摘要: "",
			起因: null,
			經過: null,
			結果: null,
			發生時間: null,
			熱度標籤: null,
		} as const;
		const out = assembleDraftJSON(
			draft(),
			facts as unknown as Parameters<typeof assembleDraftJSON>[1],
			"2026-06-22T00:00:00.000Z",
		);
		expect(out.gossipFacts).not.toBeNull();
		expect(out.gossipFacts?.當事人).toBe("明星A");
		expect(out.gossipFacts?.來源連結).toBe("https://src.com");
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
	it("renders subtitle as blockquote", () => {
		const md = assembleDraftMarkdown(draft({ subtitle: "小标" }));
		expect(md).toContain("> 小标");
	});
	it("renders description paragraph", () => {
		const md = assembleDraftMarkdown(draft({ description: "摘要段落" }));
		expect(md).toContain("摘要段落");
	});
	it("O2: renders coverImageUrl as Markdown image after title", () => {
		const md = assembleDraftMarkdown(
			draft({ coverImageUrl: "https://img.example.com/c.jpg" }),
		);
		expect(md).toContain("![封面](https://img.example.com/c.jpg)");
		// 圖片必須出現在標題之後
		expect(md.indexOf("# 标题")).toBeLessThan(md.indexOf("![封面]"));
	});
	it("O2: omits cover image block when coverImageUrl is empty", () => {
		const md = assembleDraftMarkdown(draft({ coverImageUrl: "" }));
		expect(md).not.toContain("![封面]");
	});
	it("O2: renders facts section with 吃瓜事实 heading", () => {
		const facts = {
			當事人: "明星A",
			來源連結: "https://src.com",
			事件摘要: null,
			起因: null,
			經過: null,
			結果: null,
			發生時間: null,
			熱度標籤: null,
		};
		const md = assembleDraftMarkdown(
			draft(),
			facts as Parameters<typeof assembleDraftMarkdown>[1],
		);
		expect(md).toContain("## 吃瓜事实");
		expect(md).toContain("**當事人**: 明星A");
		// 來源連結 rendered as 来源 line
		expect(md).toContain("**来源**: https://src.com");
	});
	it("O2: omits facts section when no facts provided", () => {
		const md = assembleDraftMarkdown(draft());
		expect(md).not.toContain("## 吃瓜事实");
	});
});
