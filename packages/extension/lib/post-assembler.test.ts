// @vitest-environment jsdom

import {
	assembleDraft,
	containsPlaceholder,
	type DraftSlots,
	type FactsBlock,
	factUrls,
	PLACEHOLDER,
	sanitizeToPlainText,
} from "@51guapi/shared";
import { describe, expect, it } from "vitest";
import { hasUnsourcedLink, verifyLinks } from "./link-source";

describe("containsPlaceholder", () => {
	it("裸式【待补】命中", () => {
		expect(containsPlaceholder("作品名【待补】")).toBe(true);
	});
	it("标注式【待补:作品名】命中", () => {
		expect(containsPlaceholder("【待补:作品名】")).toBe(true);
	});
	it("未闭合/残缺【待补(无 】)命中", () => {
		expect(containsPlaceholder("漢化:【待补")).toBe(true);
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
	intro: "嗨嗨~大家好我是51娘",
	highlights: "本作看点满满",
	...over,
});

const FULL: FactsBlock = {
	作品名: "住在拔作島上的我該如何是好",
	集数: "2期",
	制作: "某社",
	漢化: "https://example.com/hanhua",
	無修: "https://example.com/uncen",
	简介: "岛上日常",
};

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

describe("assembleDraft — 全事实", () => {
	const out = assembleDraft(slots({ titleSuffix: "成人動畫介紹" }), FULL);

	it("title = 作品名(verbatim) + 套话后缀", () => {
		expect(out.title).toBe("住在拔作島上的我該如何是好成人動畫介紹");
	});
	it("抬头块 facts verbatim", () => {
		expect(out.body).toContain("作品名:住在拔作島上的我該如何是好");
		expect(out.body).toContain("集数:2期");
		expect(out.body).toContain("制作:某社");
	});
	it("连结块来自 facts 的 URL(verbatim <a>)", () => {
		expect(out.body).toContain('<a href="https://example.com/hanhua">');
		expect(out.body).toContain('<a href="https://example.com/uncen">');
	});
	it("散文被包 <p>", () => {
		expect(out.body).toContain("<p>嗨嗨~大家好我是51娘</p>");
		expect(out.body).toContain("<p>本作看点满满</p>");
	});
	it("description 取 facts.简介 verbatim", () => {
		expect(out.description).toBe("岛上日常");
	});
	it("【不变量】verifyLinks(body) 无任何 unsourced 连结", () => {
		const checks = verifyLinks(out.body, factUrls(FULL));
		expect(hasUnsourcedLink(checks)).toBe(false);
		expect(checks.length).toBe(2);
	});
});

describe("assembleDraft — 散文夹连结/HTML(防注入)", () => {
	it("散文里的 <a>/裸 URL 被剥,绝不进 body 成链", () => {
		const out = assembleDraft(
			slots({
				intro:
					'看这个 <a href="https://fake.com">点我</a> 还有 https://other.com/x',
			}),
			FULL,
		);
		// 散文里的假链被剥成纯文本/【待补】,不出现 fake/other 域名作为 href
		expect(out.body).not.toContain('href="https://fake.com"');
		expect(out.body).not.toContain("https://other.com");
		// body 只剩 facts 的两条合法连结
		const checks = verifyLinks(out.body, factUrls(FULL));
		expect(hasUnsourcedLink(checks)).toBe(false);
	});

	it("【不变量】即便散文全是别的域名,verifyLinks 仍无 unsourced", () => {
		const out = assembleDraft(
			slots({ intro: "https://a.com https://b.com", highlights: "www.c.com" }),
			FULL,
		);
		expect(hasUnsourcedLink(verifyLinks(out.body, factUrls(FULL)))).toBe(false);
	});
});

describe("assembleDraft — 缺事实 → 整行省略(不污染正文)", () => {
	it("缺漢化/缺作品名:省略对应行,title【待补】,已提供字段照常", () => {
		const out = assembleDraft(slots({ titleSuffix: "介紹" }), {
			集数: "12话",
			無修: "https://ok.com/u",
		});
		expect(out.title).toBe(PLACEHOLDER);
		expect(out.body).not.toContain("作品名"); // 缺 → 不渲染该行
		expect(out.body).not.toContain("漢化連結"); // 缺 → 不渲染该行
		expect(out.body).toContain('無修連結:<a href="https://ok.com/u">');
		expect(out.body).toContain("集数:12话");
	});

	it("零事实:无抬头/无连结,仅散文,title【待补】", () => {
		const out = assembleDraft(slots(), {});
		expect(out.title).toBe(PLACEHOLDER);
		expect(out.body).not.toContain("作品名");
		expect(out.body).not.toContain("漢化連結");
		expect(out.body).not.toContain("無修連結");
		expect(out.body).not.toContain(PLACEHOLDER); // 正文零【待补】
		expect(out.body).toContain("<p>嗨嗨~大家好我是51娘</p>");
		expect(verifyLinks(out.body, factUrls({})).length).toBe(0);
	});
});

describe("assembleDraft — XSS 注入散文", () => {
	it("<script>/onerror 不进 body", () => {
		const out = assembleDraft(
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
		const out = assembleDraft(slots(), { 作品名: 'A<b>&"C' });
		expect(out.body).toContain("作品名:A&lt;b&gt;&amp;&quot;C");
		expect(out.body).not.toContain("作品名:A<b>");
	});

	it("未闭合标签绕过 strip 后仍被 esc 中和(< 成 &lt;,不成活标签)", () => {
		const out = assembleDraft(slots({ intro: "<img src=x onerror=alert(1)" }), {
			作品名: "A",
		});
		expect(out.body).not.toContain("<img"); // 无存活标签(onerror 残留为惰性文字,无害)
		expect(out.body).toContain("&lt;img");
	});

	it("facts 连结值含引号/markup → href 不被属性突破", () => {
		const facts = { 作品名: "A", 漢化: 'https://e.com/"><script>x' };
		const out = assembleDraft(slots(), facts);
		expect(out.body).not.toContain("<script>");
		expect(out.body).not.toContain('"><'); // 引号被转义,无法突破 href 属性
		expect(hasUnsourcedLink(verifyLinks(out.body, factUrls(facts)))).toBe(
			false,
		);
	});
});

describe("assembleDraft — 连结字段含额外文本", () => {
	it("字段里抽 URL 作 href,与 factUrls 比对一致", () => {
		const out = assembleDraft(slots(), {
			作品名: "X",
			漢化: "汉化组:https://h.com/p 已完结",
		});
		expect(out.body).toContain('<a href="https://h.com/p">');
		expect(
			hasUnsourcedLink(
				verifyLinks(
					out.body,
					factUrls({ 漢化: "汉化组:https://h.com/p 已完结" }),
				),
			),
		).toBe(false);
	});
});
