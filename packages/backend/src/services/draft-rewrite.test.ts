// @vitest-environment node

import type { ContentDraft, Settings } from "@51guapi/shared";
import { assembleDraftJSON, assembleDraftMarkdown } from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
import { rewriteDraftLlm } from "./draft-rewrite.js";

const settings: Settings = {
	endpoint: "https://api.example.com/v1",
	model: "gpt-4o-mini",
	fallbackModel: "",
	promptTemplate: "",
	fewShotPairs: [],
};

const draft: ContentDraft = {
	id: "d1",
	title: "原标题",
	subtitle: "",
	category: "緋聞",
	coverImageUrl: "",
	body: "<p>原正文</p>",
	tags: [],
	description: "",
	status: "draft",
	createdAt: "2026-06-22T00:00:00.000Z",
};

// 模型返回任意 JSON 槽位。
function modelReturns(content: Record<string, unknown>) {
	return vi.fn(
		async () =>
			({
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => ({
					choices: [{ message: { content: JSON.stringify(content) } }],
				}),
			}) as Response,
	);
}

async function rewrite(content: Record<string, unknown>, base = draft) {
	return rewriteDraftLlm(base, ["body_richness"], {
		settings,
		apiKey: "k",
		fetchFn: modelReturns(content),
	});
}

// A5(二轮审稿终定):rewrite 视模型为只写散文,把 body/title/tags 经 sanitizeToPlainText
// (+body 再 esc)中和后再存储/导出。不依赖任何客户端允许集(rewrite 整个 draft 来自客户端、
// 无服务端 ground truth)。真 sink 是 export.ts 的 verbatim JSON/Markdown 导出。
describe("rewriteDraftLlm — A5 纯散文中和(P0,不依赖任何客户端允许集)", () => {
	const EVIL = "https://evil.example.net/x";

	it("anchor 形式链接 → 中和(body 不含 evil、不含 <a>),ok:true 非拒绝", async () => {
		const res = await rewrite({ body: `<p>看<a href="${EVIL}">这里</a></p>` });
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.draft.body).not.toContain("evil.example.net");
			expect(res.draft.body).not.toContain("<a");
		}
	});

	it("裸文本形式链接 → 中和为【待补】(verifier 只扫 anchor 的盲区,靠中和挡住)", async () => {
		const res = await rewrite({ body: `<p>详情见 ${EVIL} 速看</p>` });
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.draft.body).not.toContain("evil.example.net");
			expect(res.draft.body).toContain("【待补】");
		}
	});

	it("markdown 形式链接 → URL 被剥(中和)", async () => {
		const res = await rewrite({ body: `<p>[点我](${EVIL})</p>` });
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.draft.body).not.toContain("evil.example.net");
	});

	it("title 返回 URL → 中和", async () => {
		const res = await rewrite({
			title: `爆! ${EVIL} 速看`,
			body: "<p>正文</p>",
		});
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.draft.title).not.toContain("evil.example.net");
	});

	it("tags 某项返回 URL → 中和", async () => {
		const res = await rewrite({ body: "<p>正文</p>", tags: ["正常", EVIL] });
		expect(res.ok).toBe(true);
		if (res.ok)
			expect(res.draft.tags.join("|")).not.toContain("evil.example.net");
	});

	it("客户端把链接塞进原 draft.body 也无法自我放行(函数签名已无 facts 允许集)", async () => {
		const res = await rewrite(
			{ body: `<p>引用 ${EVIL}</p>` },
			{ ...draft, body: `<p><a href="${EVIL}">x</a></p>` },
		);
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.draft.body).not.toContain("evil.example.net");
	});

	it("集成(真 sink):中和后 body 既不进 JSON 导出也不进 Markdown 导出", async () => {
		const res = await rewrite({
			body: `<p>看<a href="${EVIL}">这里</a> 或 ${EVIL}</p>`,
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			const json = JSON.stringify(
				assembleDraftJSON(res.draft, null, "2026-06-22T00:00:00.000Z"),
			);
			const md = assembleDraftMarkdown(res.draft);
			expect(json).not.toContain("evil.example.net");
			expect(md).not.toContain("evil.example.net");
		}
	});

	it("happy path:纯散文(无链接)→ 通过,口吻保留、无误伤", async () => {
		const res = await rewrite({
			body: "<p>这是更丰富、更有爆料感的吃瓜正文。</p>",
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.draft.body).toContain("更丰富");
			expect(res.draft.body).not.toContain("【待补】");
		}
	});
});
