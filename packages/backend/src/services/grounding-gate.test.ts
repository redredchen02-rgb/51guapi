// @vitest-environment node
//
// F3:吃瓜 grounding 允许集(gossipFactUrls)+ draft-gen 守卫的组合逻辑。
// draft-gen 正常(无链接)路径的不回归由 draft-gen.test.ts 覆盖;此处钉死 P0 修复
// (允许集读 來源連結)与「未溯源链接判定」。

import { gossipFactUrls, hasUnsourcedLink, verifyLinks } from "@51guapi/shared";
import { describe, expect, it } from "vitest";

const emptyGossip = {
	當事人: null,
	事件摘要: null,
	起因: null,
	經過: null,
	結果: null,
	來源連結: null,
	發生時間: null,
	熱度標籤: null,
};

describe("gossipFactUrls", () => {
	it("从 來源連結 提取 URL(P0:让吃瓜 grounding 允许集非空)", () => {
		expect(
			gossipFactUrls({
				...emptyGossip,
				來源連結: "https://src.example.com/a",
			}),
		).toEqual(["https://src.example.com/a"]);
	});

	it("來源連結 为 null → 空允许集", () => {
		expect(gossipFactUrls(emptyGossip)).toEqual([]);
	});

	it("來源連結 无 URL 文本 → 空", () => {
		expect(
			gossipFactUrls({ ...emptyGossip, 來源連結: "无链接的描述" }),
		).toEqual([]);
	});
});

describe("draft-gen grounding 守卫(组合逻辑)", () => {
	const body = (href: string) => `<p>详见 <a href="${href}">来源</a></p>`;

	it("body 链接来自 來源連結 → 无 unsourced(通过)", () => {
		const facts = { ...emptyGossip, 來源連結: "https://src.example.com/a" };
		expect(
			hasUnsourcedLink(
				verifyLinks(body("https://src.example.com/a"), gossipFactUrls(facts)),
			),
		).toBe(false);
	});

	it("body 链接不在 facts → 判为 unsourced(疑似自造,守卫会拒)", () => {
		const facts = { ...emptyGossip, 來源連結: "https://src.example.com/a" };
		expect(
			hasUnsourcedLink(
				verifyLinks(body("https://evil-invented.net/x"), gossipFactUrls(facts)),
			),
		).toBe(true);
	});

	it("body 无链接 → 通过(吃瓜组装的常态)", () => {
		expect(
			hasUnsourcedLink(
				verifyLinks("<p>纯文字</p>", gossipFactUrls(emptyGossip)),
			),
		).toBe(false);
	});
});
