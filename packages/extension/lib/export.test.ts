// @vitest-environment jsdom
import type { ContentDraft, GossipFactsBlock } from "@51guapi/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	copyToClipboard,
	downloadFile,
	exportDraftAsJSON,
	exportDraftAsMarkdown,
	safeFilename,
} from "./export.js";

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
		postStatus: "1",
		publishedAt: "2026-06-15",
		mediaId: "",
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
