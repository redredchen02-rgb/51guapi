// @vitest-environment jsdom
import type {
	ContentDraft,
	GossipFactsBlock,
	TopicForCSV,
} from "@51guapi/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	copyToClipboard,
	downloadFile,
	exportDraftAsJSON,
	exportDraftAsMarkdown,
	exportTopicsAsCSV,
	safeFilename,
} from "./export.js";

function makeTopic(overrides: Partial<TopicForCSV> = {}): TopicForCSV {
	return {
		id: "t1",
		title: "吃瓜标题",
		siteName: "示例站",
		sourceUrl: "https://example.com/post/1",
		confidence: 0.8,
		qualityScore: 0.75,
		domain: "gossip",
		createdAt: "2026-06-15T00:00:00Z",
		facts: {
			當事人: "A,B",
			事件摘要: "两人疑似分手",
			起因: "起因内容",
			經過: "经过内容",
			結果: "结果内容",
			來源連結: "https://example.com/post/1",
			發生時間: "2026-06",
			熱度標籤: "分手",
		},
		...overrides,
	};
}

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: "d1",
		title: "吃瓜标题",
		subtitle: "副标题",
		category: "2",
		coverImageUrl: "",
		body: "<p>正文第一段</p><p>正文第二段</p>",
		tags: ["标签A", "标签B"],
		description: "一句话描述",
		status: "draft",
		createdAt: "2026-06-15T00:00:00Z",
		...overrides,
	} as ContentDraft;
}

function makeFacts(
	overrides: Partial<GossipFactsBlock> = {},
): GossipFactsBlock {
	return {
		當事人: "A,B",
		事件摘要: "两人疑似分手",
		起因: null,
		經過: null,
		結果: null,
		來源連結: "https://example.com/post/1",
		發生時間: "2026-06",
		熱度標籤: "分手",
		...overrides,
	};
}

describe("exportDraftAsMarkdown", () => {
	it("Happy: 产出含标题/正文/来源的 Markdown", () => {
		const md = exportDraftAsMarkdown(makeDraft(), makeFacts());
		expect(md).toContain("# 吃瓜标题");
		expect(md).toContain("正文第一段");
		expect(md).toContain("正文第二段");
		expect(md).toContain("**来源**: https://example.com/post/1");
		expect(md).toContain("## 吃瓜事实");
		expect(md).toContain("- **當事人**: A,B");
	});

	it("Edge: 缺配图/来源不抛错且省略缺项", () => {
		const md = exportDraftAsMarkdown(
			makeDraft({ subtitle: "", description: "" }),
			makeFacts({ 來源連結: null }),
		);
		expect(md).not.toContain("**来源**");
		expect(md).toContain("# 吃瓜标题");
	});

	it("Edge: 无吃瓜事实仍可导出", () => {
		const md = exportDraftAsMarkdown(makeDraft());
		expect(md).not.toContain("## 吃瓜事实");
		expect(md).toContain("# 吃瓜标题");
	});

	it("Edge: 特殊字符 # | 换行 正确转义", () => {
		const md = exportDraftAsMarkdown(
			makeDraft({
				title: "# 标题|带管道",
				body: "<p>含 # 井号 | 管道</p>",
			}),
		);
		// 标题里的 # 与 | 被转义
		expect(md).toContain("# \\# 标题\\|带管道");
		expect(md).toContain("\\# 井号 \\| 管道");
	});
});

describe("exportDraftAsJSON", () => {
	it("Happy: 产出可被 JSON.parse 还原的结构", () => {
		const json = exportDraftAsJSON(makeDraft(), makeFacts());
		const parsed = JSON.parse(json);
		expect(parsed.draft.title).toBe("吃瓜标题");
		expect(parsed.draft.tags).toEqual(["标签A", "标签B"]);
		expect(parsed.gossipFacts.當事人).toBe("A,B");
		expect(parsed.schemaVersion).toBe("0.1");
	});

	it("Edge: 无 facts 时 gossipFacts 为 null", () => {
		const parsed = JSON.parse(exportDraftAsJSON(makeDraft()));
		expect(parsed.gossipFacts).toBeNull();
	});
});

describe("safeFilename", () => {
	it("去非法字符并加扩展名", () => {
		expect(safeFilename(makeDraft({ title: "a/b:c?d" }), "md")).toBe(
			"a_b_c_d.md",
		);
	});
});

describe("copyToClipboard", () => {
	it("调用 navigator.clipboard.writeText", async () => {
		const writeText = vi.fn(async () => {});
		Object.assign(navigator, { clipboard: { writeText } });
		await copyToClipboard("hello");
		expect(writeText).toHaveBeenCalledWith("hello");
	});
});

describe("exportTopicsAsCSV", () => {
	it("Happy: 3 条完整 facts → 表头 + 3 列,对齐吃瓜事实 8 栏", () => {
		const csv = exportTopicsAsCSV([makeTopic(), makeTopic(), makeTopic()]);
		const lines = csv.split("\r\n");
		expect(lines).toHaveLength(4); // 表头 + 3 列
		const header = lines[0]!.split(",");
		// 8 元资料 + 8 事实 = 16 栏
		expect(header).toHaveLength(16);
		expect(header.slice(0, 8)).toEqual([
			"id",
			"title",
			"siteName",
			"sourceUrl",
			"confidence",
			"score",
			"domain",
			"createdAt",
		]);
		expect(header.slice(8)).toEqual([
			"當事人",
			"事件摘要",
			"起因",
			"經過",
			"結果",
			"來源連結",
			"發生時間",
			"熱度標籤",
		]);
		// score 取自 qualityScore
		expect(lines[1]!.split(",")[5]).toBe("0.75");
	});

	it("Edge: facts 部分为 null/缺失 → 对应格为空不报错", () => {
		const csv = exportTopicsAsCSV([
			makeTopic({
				qualityScore: undefined,
				facts: { 當事人: "C", 來源連結: null },
			}),
		]);
		const cells = csv.split("\r\n")[1]!.split(",");
		expect(cells[5]).toBe(""); // score 缺失
		expect(cells[8]).toBe("C"); // 當事人
		expect(cells[9]).toBe(""); // 事件摘要 缺失
		expect(cells[13]).toBe(""); // 來源連結 为 null
	});

	it("Edge: 标题含逗号/双引号/换行 → 正确转义", () => {
		const csv = exportTopicsAsCSV([
			makeTopic({ title: 'a,b "quoted"\nline2', facts: {} }),
		]);
		const lines = csv.split("\r\n");
		// 整列含特殊字符:用双引号包裹,内部 " → ""
		expect(lines[1]!).toContain('"a,b ""quoted""\nline2"');
		// 表头本身无特殊字符,不受影响
		expect(lines[0]!).toContain("title");
	});

	it("Edge: 空列表 → 只有表头一行", () => {
		const csv = exportTopicsAsCSV([]);
		expect(csv.split("\r\n")).toHaveLength(1);
		expect(csv).toContain("id,title,siteName");
	});

	it("Security: 以 = + - @ 起首的不可信单元格被前导单引号中和(公式注入)", () => {
		const csv = exportTopicsAsCSV([
			makeTopic({
				title: '=HYPERLINK("http://evil","x")',
				facts: { 當事人: "+1+2", 事件摘要: "-cmd", 起因: "@SUM(A1)" },
			}),
		]);
		const cells = csv.split("\r\n")[1]!;
		// title 含逗号会被 RFC 包裹,但内容须以 '= 开头(中和后)
		expect(cells).toContain("\"'=HYPERLINK");
		expect(cells).toContain("'+1+2");
		expect(cells).toContain("'-cmd");
		expect(cells).toContain("'@SUM(A1)");
	});

	it("Security: 数字 score/confidence 列不被误加单引号", () => {
		const csv = exportTopicsAsCSV([makeTopic({ facts: {} })]);
		const cells = csv.split("\r\n")[1]!.split(",");
		expect(cells[4]).toBe("0.8"); // confidence 数字
		expect(cells[5]).toBe("0.75"); // score 数字
	});
});

describe("downloadFile", () => {
	beforeEach(() => {
		globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
		globalThis.URL.revokeObjectURL = vi.fn();
	});

	it("创建 a[download] 并触发 click", () => {
		const click = vi.fn();
		const orig = document.createElement.bind(document);
		const spy = vi
			.spyOn(document, "createElement")
			.mockImplementation((tag) => {
				const el = orig(tag) as HTMLAnchorElement;
				if (tag === "a") el.click = click;
				return el;
			});
		downloadFile("x.md", "content", "text/markdown");
		expect(click).toHaveBeenCalled();
		expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
		expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
		spy.mockRestore();
	});
});
