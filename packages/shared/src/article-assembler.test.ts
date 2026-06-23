import { describe, expect, it } from "vitest";
import type { ArticleSlots } from "./article-assembler.js";
import { assembleGossipArticle } from "./article-assembler.js";
import type { GossipFactsBlock } from "./gossip-facts.js";
import { gossipFactUrls, hasUnsourcedLink, verifyLinks } from "./index.js";

const FULL_FACTS: GossipFactsBlock = {
	當事人: "张三",
	事件摘要: "网传某明星出轨",
	起因: "网友爆料",
	經過: "双方回应",
	結果: "尚无官方声明",
	來源連結: "https://example.com/gossip/123",
	發生時間: "2026-06",
	熱度標籤: "出轨,塌房",
};

const BASE_SLOTS: ArticleSlots = {
	titleSuffix: "出轨疑云曝光",
	intro: "近期某明星疑似出轨事件持续发酵，网友热议。",
	narrative: "据悉，事件起因于一组疑似私信截图在网络上流传，引发大量讨论。",
	faqItems: [
		{ q: "这件事情是真的吗？", a: "目前尚无官方确认，请以当事人声明为准。" },
		{ q: "事件现在有什么进展？", a: "根据现有公开信息，尚无最新进展。" },
		{ q: "粉丝怎么看？", a: "粉丝社区意见分化，理性吃瓜。" },
	],
	conclusion: "事件持续关注中，等待更多官方消息。",
	tags: ["张三", "出轨", "吃瓜"],
};

describe("assembleGossipArticle", () => {
	it("正常路径：title = 當事人 + titleSuffix", () => {
		const result = assembleGossipArticle(BASE_SLOTS, FULL_FACTS);
		expect(result.title).toBe("张三出轨疑云曝光");
	});

	it("當事人为 null → title 使用 PLACEHOLDER", () => {
		const facts: GossipFactsBlock = { ...FULL_FACTS, 當事人: null };
		const result = assembleGossipArticle(BASE_SLOTS, facts);
		expect(result.title).toBe("【待补】出轨疑云曝光");
	});

	it("titleSuffix 缺失 → title 仅为 當事人", () => {
		const slots: ArticleSlots = { ...BASE_SLOTS, titleSuffix: undefined };
		const result = assembleGossipArticle(slots, FULL_FACTS);
		expect(result.title).toBe("张三");
	});

	it("body 包含所有 8 个 section 注释标记", () => {
		const result = assembleGossipArticle(BASE_SLOTS, FULL_FACTS);
		for (const section of [
			"intro",
			"quickinfo",
			"narrative",
			"images",
			"video",
			"faq",
			"conclusion",
			"source",
		]) {
			expect(result.body).toContain(`<!-- section:${section} -->`);
		}
	});

	it("quickinfo 包含 verbatim facts，不经模型处理", () => {
		const result = assembleGossipArticle(BASE_SLOTS, FULL_FACTS);
		expect(result.body).toContain("张三");
		expect(result.body).toContain("2026-06");
		expect(result.body).toContain("出轨,塌房");
	});

	it("quickinfo 跳过空字段", () => {
		const facts: GossipFactsBlock = {
			...FULL_FACTS,
			起因: null,
			經過: null,
			結果: null,
		};
		const result = assembleGossipArticle(BASE_SLOTS, facts);
		// 提取 quickinfo 节内容（section:quickinfo 到下一个 section 之间）
		const qiStart = result.body.indexOf("<!-- section:quickinfo -->");
		const qiEnd = result.body.indexOf("<!-- section:", qiStart + 1);
		const qiSection = result.body.slice(qiStart, qiEnd);
		expect(qiSection).not.toContain("起因：");
		expect(qiSection).not.toContain("经过：");
		expect(qiSection).not.toContain("结果/当前进展：");
		// 非空字段仍出现
		expect(qiSection).toContain("人物/主体：张三");
	});

	it("grounding 守卫：body 里唯一 <a href> 来自 facts.來源連結", () => {
		const result = assembleGossipArticle(BASE_SLOTS, FULL_FACTS);
		const factUrls = gossipFactUrls(FULL_FACTS);
		const linkResult = verifyLinks(result.body, factUrls);
		expect(hasUnsourcedLink(linkResult)).toBe(false);
		expect(result.body).toContain('href="https://example.com/gossip/123"');
	});

	it("grounding 守卫：來源連結为 null 时 body 里零 <a href>", () => {
		const facts: GossipFactsBlock = { ...FULL_FACTS, 來源連結: null };
		const result = assembleGossipArticle(BASE_SLOTS, facts);
		expect(result.body).not.toContain("<a href");
		expect(
			hasUnsourcedLink(verifyLinks(result.body, gossipFactUrls(facts))),
		).toBe(false);
	});

	it("散文槽位里的裸 URL → 被替换为 【待补】", () => {
		const slots: ArticleSlots = {
			...BASE_SLOTS,
			intro: "详情见 https://evil.com/leak 后续跟进",
			narrative: "视频在 http://malicious.io/vid",
		};
		const result = assembleGossipArticle(slots, FULL_FACTS);
		expect(result.body).not.toContain("evil.com");
		expect(result.body).not.toContain("malicious.io");
		expect(result.body).toContain("【待补】");
	});

	it("散文槽位里的 HTML 标签 → 被剥除，文本内容保留但无可执行标签", () => {
		const slots: ArticleSlots = {
			...BASE_SLOTS,
			intro: "事件<script>alert(1)</script>引发关注",
		};
		const result = assembleGossipArticle(slots, FULL_FACTS);
		// script 标签被剥除（防 HTML 注入）
		expect(result.body).not.toContain("<script>");
		expect(result.body).not.toContain("</script>");
		// 前后文本内容保留
		expect(result.body).toContain("事件");
		expect(result.body).toContain("引发关注");
	});

	it("散文槽位里的 --> 序列 → 被替换为 — 防破坏 HTML 注释", () => {
		const slots: ArticleSlots = {
			...BASE_SLOTS,
			intro: "进展A-->B-->C已确认",
		};
		const result = assembleGossipArticle(slots, FULL_FACTS);
		// 剥除 section 注释标记（<!-- section:X --> 本身含 -->，不是散文来源）
		const bodyWithoutMarkers = result.body.replace(
			/<!-- section:[a-z]+ -->/g,
			"",
		);
		expect(bodyWithoutMarkers).not.toContain("-->");
		// 替换结果为 em-dash
		expect(result.body).toContain("A—B—C");
	});

	it("faqItems 为空 → FAQ section 注释存在，无 Q/A 内容", () => {
		const slots: ArticleSlots = { ...BASE_SLOTS, faqItems: [] };
		const result = assembleGossipArticle(slots, FULL_FACTS);
		expect(result.body).toContain("<!-- section:faq -->");
		expect(result.body).not.toContain("<strong>Q：</strong>");
	});

	it("faqItems 的 q 和 a 均经 sanitize+esc 处理", () => {
		const slots: ArticleSlots = {
			...BASE_SLOTS,
			faqItems: [
				{
					q: "有<b>内幕</b>吗？网址 https://leak.io",
					a: "暂时不得而知 --> 继续关注",
				},
			],
		};
		const result = assembleGossipArticle(slots, FULL_FACTS);
		// HTML 标签被剥除
		expect(result.body).not.toContain("<b>");
		expect(result.body).not.toContain("</b>");
		// 裸 URL 被替换
		expect(result.body).not.toContain("leak.io");
		// --> 散文序列被替换（剥除 section 注释标记后检查）
		const bodyWithoutMarkers = result.body.replace(
			/<!-- section:[a-z]+ -->/g,
			"",
		);
		expect(bodyWithoutMarkers).not.toContain("-->");
		expect(result.body).toContain("— 继续关注");
	});

	it("description 优先取 facts.事件摘要", () => {
		const result = assembleGossipArticle(BASE_SLOTS, FULL_FACTS);
		expect(result.description).toBe("网传某明星出轨");
	});

	it("description 备用取 intro 截断（事件摘要为 null）", () => {
		const facts: GossipFactsBlock = { ...FULL_FACTS, 事件摘要: null };
		const result = assembleGossipArticle(BASE_SLOTS, facts);
		expect(result.description.length).toBeLessThanOrEqual(120);
	});

	it("tags 去首尾空格、过滤空项", () => {
		const slots: ArticleSlots = {
			...BASE_SLOTS,
			tags: ["  张三  ", "", "吃瓜"],
		};
		const result = assembleGossipArticle(slots, FULL_FACTS);
		expect(result.tags).toEqual(["张三", "吃瓜"]);
	});

	it("keywords 缺省时为空数组", () => {
		const slots: ArticleSlots = { ...BASE_SLOTS, keywords: undefined };
		const result = assembleGossipArticle(slots, FULL_FACTS);
		expect(result.keywords).toEqual([]);
	});

	it("图片和视频 section 为静态占位，不含 URL 和模型输入", () => {
		const result = assembleGossipArticle(BASE_SLOTS, FULL_FACTS);
		const imageIdx = result.body.indexOf("<!-- section:images -->");
		const videoIdx = result.body.indexOf("<!-- section:video -->");
		expect(imageIdx).toBeGreaterThanOrEqual(0);
		expect(videoIdx).toBeGreaterThanOrEqual(0);
		const imagesSection = result.body.slice(imageIdx, videoIdx);
		expect(imagesSection).not.toContain("<a href");
		expect(imagesSection).toContain("【待补】");
	});
});
