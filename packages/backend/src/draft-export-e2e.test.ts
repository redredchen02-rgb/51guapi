// @vitest-environment node
//
// E2 — 防幻觉安全脊樑 e2e:facts → generateDraft →(assembler sanitize+esc 中和)→ shared 导出。
// 真 generateDraft（draft-gen.ts）+ 真 shared assembleDraftJSON/assembleDraftMarkdown;
// 仅经 LlmDeps.fetchFn 注入受控 LLM 响应(OpenAI 兼容形,参照 routes/drafts-generate-slots.test.ts)。
//
// 真 sink = assembler 中和(post-assembler.ts 的 sanitizeToPlainText+esc,已在 main)+ verbatim 导出。
// grounding 闸(draft-gen.ts:334)对已中和的 body 结构性恒过(:331 注释自陈)、不可达 reject —— 故本测试
// **不断言** kind:"grounding",而断言「模型散文里的链接被中和、绝不进 body 与导出物」。
// grounding 闸的 reject 行为留 shared/link-source.test.ts 单测层。

import {
	assembleDraftJSON,
	assembleDraftMarkdown,
	type GossipFactsBlock,
	type Settings,
} from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
import { generateDraft } from "./services/llm.js";

// OpenAI 兼容响应:content 是 slots 的 JSON 字符串。
function mockFetch(slots: Record<string, unknown>): typeof fetch {
	const payload = {
		choices: [{ message: { content: JSON.stringify(slots) } }],
	};
	return vi.fn(
		async () =>
			({
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => payload,
			}) as Response,
	) as unknown as typeof fetch;
}

const SETTINGS: Settings = {
	endpoint: "https://api.example.com/v1/chat/completions",
	model: "gpt-4o-mini",
	fallbackModel: "",
	promptTemplate: "t",
	fewShotPairs: [],
};

const FACTS: GossipFactsBlock = {
	當事人: "周杰倫",
	事件摘要: "疑似新瓜曝光",
	起因: "被拍到現身機場",
	經過: "工作室回應",
	結果: "證實普通行程",
	來源連結: "https://gossip.example.com/article-123",
	發生時間: "2026-06-20",
	熱度標籤: "出軌",
};

const EVIL = "evil.com";
const SOURCE = "gossip.example.com/article-123";

// 模型试图在散文(intro/highlights)夹三种形态的外链:anchor / 裸 URL / markdown。
// titleSuffix/subtitle 保持洁净(titleSuffix 不过 sanitize,见文件末注)。
const POISONED_SLOTS = {
	titleSuffix: "出軌疑雲",
	subtitle: "一句吸睛副標",
	intro: '吃瓜開場,點此<a href="https://evil.com/anchor">獨家</a>看更多。',
	highlights:
		"重點來了 https://evil.com/bare 另有 [完整版](https://evil.com/md) 可看。",
	outro: "歡迎吃瓜。",
};

function genPoisoned() {
	return generateDraft("主题", {
		settings: SETTINGS,
		apiKey: "k",
		facts: FACTS,
		fetchFn: mockFetch(POISONED_SLOTS),
		now: () => "2026-06-20T00:00:00.000Z",
		genId: () => "draft_e2e_1",
	});
}

describe("E2 生成→中和→导出 安全脊樑", () => {
	it("生成路径:模型散文里的三形态外链被 assembler 中和,facts verbatim 注入 body", async () => {
		// anti-false-green:确认输入确实被投毒,否则 not.toContain 形同虚设。
		expect(POISONED_SLOTS.intro).toContain(EVIL);
		expect(POISONED_SLOTS.highlights).toContain(EVIL);

		const res = await genPoisoned();
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const { draft } = res;

		// 安全(P0):anchor/裸/markdown 三形态 evil.com 全被中和,body 零外链。
		expect(draft.body).not.toContain(EVIL);
		// facts verbatim:當事人 进 title/body;合法来源由系统从 facts.來源連結 注入(模型碰不到)。
		expect(draft.title).toContain("周杰倫");
		expect(draft.body).toContain("周杰倫");
		expect(draft.body).toContain(SOURCE);
	});

	it("导出 sink:中和后的 body 与 facts 经 JSON/Markdown 导出,evil.com 零泄漏、facts verbatim 保留", async () => {
		const res = await genPoisoned();
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		const { draft } = res;

		const json = JSON.stringify(
			assembleDraftJSON(draft, FACTS, "2026-06-20T00:00:00.000Z"),
		);
		const md = assembleDraftMarkdown(draft, FACTS);

		// P0:真 sink(verbatim 导出)零 evil.com —— 三形态都已在 body 内被中和,facts 本就不含 evil。
		expect(json).not.toContain(EVIL);
		expect(md).not.toContain(EVIL);
		// facts verbatim 落入两种导出物。
		expect(json).toContain("周杰倫");
		expect(json).toContain(SOURCE);
		expect(md).toContain("周杰倫");
		expect(md).toContain(SOURCE);
	});

	it("纯散文(无链接)→ 通过、口吻保留、导出正常(证中和不误伤合法散文)", async () => {
		const clean = {
			titleSuffix: "出軌疑雲",
			subtitle: "吸睛副標",
			intro: "純粹吃瓜開場白沒有任何連結。",
			highlights: "看點滿滿都是口吻散文。",
			outro: "歡迎吃瓜。",
		};
		const res = await generateDraft("主题", {
			settings: SETTINGS,
			apiKey: "k",
			facts: FACTS,
			fetchFn: mockFetch(clean),
			now: () => "2026-06-20T00:00:00.000Z",
			genId: () => "draft_e2e_clean",
		});
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		// 合法散文口吻保留(未被中和误伤)。
		expect(res.draft.body).toContain("純粹吃瓜開場白");
		expect(res.draft.body).toContain("看點滿滿");
		const md = assembleDraftMarkdown(res.draft, FACTS);
		expect(md).toContain("純粹吃瓜開場白");
	});
});

// 观察(非本单元断言,留作后续):assembleGossipDraft 的 `titleSuffix` 不过 sanitizeToPlainText
// (post-assembler.ts:107 直接拼 `${name}${titleSuffix}`),故模型若在 titleSuffix 夹 URL 会 verbatim
// 进 title 与导出物 —— 这是生成路径上 prose 之外的另一个未中和向量,值得作为独立 finding 评估。
