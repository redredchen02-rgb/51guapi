// @vitest-environment jsdom

import {
	assembleGossipDraft,
	containsPlaceholder,
	type DraftSlots,
	type GossipFactsBlock,
	gossipFactUrls,
	hasUnsourcedLink,
	PLACEHOLDER,
	sanitizeToPlainText,
	verifyLinks,
} from "@51guapi/shared";
import { describe, expect, it } from "vitest";

describe("containsPlaceholder", () => {
	it("裸式【待补】命中", () => {
		expect(containsPlaceholder("當事人【待补】")).toBe(true);
	});
	it("标注式【待补:當事人】命中", () => {
		expect(containsPlaceholder("【待补:當事人】")).toBe(true);
	});
	it("未闭合/残缺【待补(无 】)命中", () => {
		expect(containsPlaceholder("來源:【待补")).toBe(true);
	});
	it("干净文本返回 false", () => {
		expect(containsPlaceholder("正常标题")).toBe(false);
	});
	it("空串/undefined/null 返回 false 且不抛错", () => {
		expect(containsPlaceholder("")).toBe(false);
		expect(containsPlaceholder(undefined)).toBe(false);
		expect(containsPlaceholder(null)).toBe(false);
	});
});

const slots = (over: Partial<DraftSlots> = {}): DraftSlots => ({
	intro: "嗨!瓜哥来了",
	highlights: "这瓜有点大",
	...over,
});

/** 造吃瓜 facts:默认全 null,按需 override。 */
const gf = (over: Partial<GossipFactsBlock> = {}): GossipFactsBlock => ({
	當事人: null,
	事件摘要: null,
	起因: null,
	經過: null,
	結果: null,
	來源連結: null,
	發生時間: null,
	熱度標籤: null,
	...over,
});

const FULL: GossipFactsBlock = gf({
	當事人: "明星A与明星B",
	事件摘要: "疑似出轨事件",
	發生時間: "2026-06",
	熱度標籤: "出軌",
	來源連結: "https://example.com/news",
});

describe("sanitizeToPlainText", () => {
	it("剥 HTML 标签", () => {
		expect(sanitizeToPlainText("<b>粗</b>体")).toBe("粗 体");
	});
	it("裸 URL → 【待补】(模型不得自造连结)", () => {
		expect(sanitizeToPlainText("点这里 https://evil.com/x 看")).toBe(
			`点这里 ${PLACEHOLDER} 看`,
		);
		expect(sanitizeToPlainText("www.evil.com 走起")).toBe(
			`${PLACEHOLDER} 走起`,
		);
	});
	it("空输入安全", () => {
		expect(sanitizeToPlainText(undefined)).toBe("");
		expect(sanitizeToPlainText("")).toBe("");
	});
});

describe("assembleGossipDraft — 全事实", () => {
	const out = assembleGossipDraft(slots({ titleSuffix: "出軌疑雲" }), FULL);

	it("title = 當事人(verbatim) + 套话后缀", () => {
		expect(out.title).toBe("明星A与明星B出軌疑雲");
	});
	it("抬头块 facts verbatim", () => {
		expect(out.body).toContain("當事人:明星A与明星B");
		expect(out.body).toContain("發生時間:2026-06");
		expect(out.body).toContain("話題標籤:出軌");
	});
	it("来源连结来自 facts 的 URL(verbatim <a>)", () => {
		expect(out.body).toContain('<a href="https://example.com/news">');
	});
	it("散文被包 <p>", () => {
		expect(out.body).toContain("<p>嗨!瓜哥来了</p>");
		expect(out.body).toContain("<p>这瓜有点大</p>");
	});
	it("description 取 facts.事件摘要 verbatim", () => {
		expect(out.description).toBe("疑似出轨事件");
	});
	it("【不变量】verifyLinks(body) 无任何 unsourced 连结", () => {
		const checks = verifyLinks(out.body, gossipFactUrls(FULL));
		expect(hasUnsourcedLink(checks)).toBe(false);
		expect(checks.length).toBe(1);
	});
});

describe("assembleGossipDraft — 散文夹连结/HTML(防注入)", () => {
	it("散文里的 <a>/裸 URL 被剥,绝不进 body 成链", () => {
		const out = assembleGossipDraft(
			slots({
				intro:
					'看这个 <a href="https://fake.com">点我</a> 还有 https://other.com/x',
			}),
			FULL,
		);
		expect(out.body).not.toContain('href="https://fake.com"');
		expect(out.body).not.toContain("https://other.com");
		const checks = verifyLinks(out.body, gossipFactUrls(FULL));
		expect(hasUnsourcedLink(checks)).toBe(false);
	});

	it("【不变量】即便散文全是别的域名,verifyLinks 仍无 unsourced", () => {
		const out = assembleGossipDraft(
			slots({ intro: "https://a.com https://b.com", highlights: "www.c.com" }),
			FULL,
		);
		expect(hasUnsourcedLink(verifyLinks(out.body, gossipFactUrls(FULL)))).toBe(
			false,
		);
	});
});

describe("assembleGossipDraft — 缺事实 → 整行省略(不污染正文)", () => {
	it("缺來源連結/缺當事人:省略对应行,title【待补】,已提供字段照常", () => {
		const out = assembleGossipDraft(
			slots({ titleSuffix: "疑雲" }),
			gf({ 發生時間: "2026-06", 熱度標籤: "塌房" }),
		);
		expect(out.title).toBe(PLACEHOLDER);
		expect(out.body).not.toContain("當事人:"); // 缺 → 不渲染该行
		expect(out.body).not.toContain("來源連結"); // 缺 → 不渲染该行
		expect(out.body).toContain("發生時間:2026-06");
		expect(out.body).toContain("話題標籤:塌房");
	});

	it("零事实:无抬头/无连结,仅散文,title【待补】", () => {
		const out = assembleGossipDraft(slots(), gf());
		expect(out.title).toBe(PLACEHOLDER);
		expect(out.body).not.toContain("當事人:");
		expect(out.body).not.toContain("來源連結");
		expect(out.body).not.toContain(PLACEHOLDER); // 正文零【待补】
		expect(out.body).toContain("<p>嗨!瓜哥来了</p>");
		expect(verifyLinks(out.body, gossipFactUrls(gf())).length).toBe(0);
	});
});

describe("assembleGossipDraft — XSS 注入散文", () => {
	it("<script>/onerror 不进 body", () => {
		const out = assembleGossipDraft(
			slots({
				intro: "<script>alert(1)</script>正文",
				highlights: "<img src=x onerror=alert(2)>看点",
			}),
			FULL,
		);
		expect(out.body).not.toContain("<script>");
		expect(out.body).not.toContain("onerror");
		expect(out.body).not.toContain("<img");
		// 文本残留被转义保留
		expect(out.body).toContain("正文");
		expect(out.body).toContain("看点");
	});

	it("facts 里的特殊字符在 body 中被转义", () => {
		const out = assembleGossipDraft(slots(), gf({ 當事人: 'A<b>&"C' }));
		expect(out.body).toContain("當事人:A&lt;b&gt;&amp;&quot;C");
		expect(out.body).not.toContain("當事人:A<b>");
	});

	it("未闭合标签绕过 strip 后仍被 esc 中和(< 成 &lt;,不成活标签)", () => {
		const out = assembleGossipDraft(
			slots({ intro: "<img src=x onerror=alert(1)" }),
			gf({ 當事人: "A" }),
		);
		expect(out.body).not.toContain("<img"); // 无存活标签(onerror 残留为惰性文字,无害)
		expect(out.body).toContain("&lt;img");
	});

	it("facts 连结值含引号/markup → href 不被属性突破", () => {
		const facts = gf({ 當事人: "A", 來源連結: 'https://e.com/"><script>x' });
		const out = assembleGossipDraft(slots(), facts);
		expect(out.body).not.toContain("<script>");
		expect(out.body).not.toContain('"><'); // 引号被转义,无法突破 href 属性
		expect(hasUnsourcedLink(verifyLinks(out.body, gossipFactUrls(facts)))).toBe(
			false,
		);
	});
});

describe("assembleGossipDraft — 连结字段含额外文本", () => {
	it("字段里抽 URL 作 href,与 gossipFactUrls 比对一致", () => {
		const facts = gf({ 當事人: "X", 來源連結: "来源:https://h.com/p 已发布" });
		const out = assembleGossipDraft(slots(), facts);
		expect(out.body).toContain('<a href="https://h.com/p">');
		expect(hasUnsourcedLink(verifyLinks(out.body, gossipFactUrls(facts)))).toBe(
			false,
		);
	});
});
