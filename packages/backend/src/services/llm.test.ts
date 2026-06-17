// @vitest-environment jsdom

import type { FactsBlock, Settings } from "@51guapi/shared";
import { assembleDraft, toDraft } from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
import {
	buildRequest,
	chatCompletionsUrl,
	generateDraft,
	listModels,
	modelsUrl,
	reviewDraftLlm,
	slotsFromParsed,
} from "../services/llm.js";

const DEFAULT_SETTINGS: Settings = {
	endpoint: "",
	model: "gpt-4o-mini",
	fallbackModel: "",
	promptTemplate: "test template",
	fewShotPairs: [],
};

const settings: Settings = {
	...DEFAULT_SETTINGS,
	endpoint: "https://api.example.com/v1/chat/completions",
	model: "gpt-4o-mini",
};

function mockFetch(
	payload: unknown,
	init?: {
		ok?: boolean;
		status?: number;
		statusText?: string;
		throwName?: string;
		throwJson?: boolean;
	},
) {
	return vi.fn(async () => {
		if (init?.throwName) {
			const e = new Error("boom");
			e.name = init.throwName;
			throw e;
		}
		return {
			ok: init?.ok ?? true,
			status: init?.status ?? 200,
			statusText: init?.statusText ?? "OK",
			json: async () => {
				if (init?.throwJson) throw new SyntaxError("invalid json");
				return payload;
			},
		} as Response;
	});
}

const oaiReply = (content: string) => ({ choices: [{ message: { content } }] });
const slotsReply = (slots: Record<string, unknown>) =>
	oaiReply(JSON.stringify(slots));
const base = { now: () => "2026-06-03T00:00:00.000Z", genId: () => "draft_1" };
const FACTS: FactsBlock = {
	作品名: "作品X",
	集数: "2期",
	漢化: "https://h.com/a",
	無修: "https://u.com/b",
	简介: "梗概",
};

describe("chatCompletionsUrl / modelsUrl", () => {
	it("base URL → 补全 chat/completions 与 models", () => {
		expect(chatCompletionsUrl("https://h.com/v1")).toBe(
			"https://h.com/v1/chat/completions",
		);
		expect(modelsUrl("https://h.com/v1")).toBe("https://h.com/v1/models");
	});
	it("完整地址 → chat 原样、models 剥换", () => {
		expect(chatCompletionsUrl("https://h.com/v1/chat/completions")).toBe(
			"https://h.com/v1/chat/completions",
		);
		expect(modelsUrl("https://h.com/v1/chat/completions")).toBe(
			"https://h.com/v1/models",
		);
	});
	it("容忍尾斜杠", () => {
		expect(chatCompletionsUrl("https://h.com/v1/")).toBe(
			"https://h.com/v1/chat/completions",
		);
		expect(modelsUrl("https://h.com/v1/")).toBe("https://h.com/v1/models");
	});
});

describe("buildRequest", () => {
	it("用派生的 chat/completions 地址(支持 base URL)", () => {
		const r = buildRequest(
			"p",
			{ ...settings, endpoint: "https://h.com/v1" },
			"k",
		);
		expect(r.url).toBe("https://h.com/v1/chat/completions");
	});
});

describe("listModels", () => {
	it("happy path:解析 data[].id 并排序", async () => {
		const f = mockFetch({
			data: [{ id: "gpt-4o" }, { id: "claude-3" }, { id: "gpt-4o-mini" }],
		});
		const r = await listModels("https://h.com/v1", "k", f);
		expect(r).toEqual({
			ok: true,
			models: ["claude-3", "gpt-4o", "gpt-4o-mini"],
		});
		// 打到 /models
		expect(f).toHaveBeenCalledWith(
			"https://h.com/v1/models",
			expect.objectContaining({ headers: { Authorization: "Bearer k" } }),
		);
	});
	it("缺 key/endpoint → 结构化错误,不发请求", async () => {
		const f = mockFetch({});
		expect(await listModels("", "k", f)).toEqual({
			ok: false,
			error: expect.stringContaining("endpoint"),
		});
		expect(f).not.toHaveBeenCalled();
	});
	it("非 https → 拒绝", async () => {
		const r = await listModels("http://h.com/v1", "k", mockFetch({}));
		expect(r.ok).toBe(false);
	});
	it("HTTP 错误 → 结构化错误", async () => {
		const r = await listModels(
			"https://h.com/v1",
			"k",
			mockFetch({}, { ok: false, status: 401, statusText: "Unauthorized" }),
		);
		expect(r).toEqual({ ok: false, error: expect.stringContaining("401") });
	});
	it("无 data 数组 → 错误", async () => {
		const r = await listModels(
			"https://h.com/v1",
			"k",
			mockFetch({ nope: true }),
		);
		expect(r.ok).toBe(false);
	});
	it("超时 → 提示重试", async () => {
		const r = await listModels(
			"https://h.com/v1",
			"k",
			mockFetch({}, { throwName: "AbortError" }),
		);
		expect(r).toEqual({ ok: false, error: expect.stringContaining("超时") });
	});
});

describe("generateDraft (结构化组装)", () => {
	it("happy path:模型只回槽位,程式把 facts verbatim 组装进 ContentDraft", async () => {
		const slots = {
			titleSuffix: "介紹",
			subtitle: "副标题",
			intro: "引子",
			highlights: "看点",
			category: "2",
			tags: ["奇幻", "冒險"],
		};
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts: FACTS,
			fetchFn: mockFetch(slotsReply(slots)),
			...base,
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.draft.title).toBe("作品X介紹");
			expect(res.draft.body).toContain("作品名:作品X");
			expect(res.draft.body).toContain('<a href="https://h.com/a">');
			expect(res.draft.body).toContain("<p>引子</p>");
			expect(res.draft.tags).toEqual(["奇幻", "冒險"]);
			// 分类经 normalizeCategory:模型给后台 value '2' → 归一化为后台真实 label(fillNativeSelect 按文本命中)。
			expect(res.draft.category).toBe("漫畫文章");
			expect(res.draft.status).toBe("draft");
			expect(res.draft.postStatus).toBe("0"); // 默认隐藏发布
			expect(res.draft.createdAt).toBe("2026-06-03T00:00:00.000Z");
		}
	});

	it("返回 slots(供扩展端重新组装);非空且字段反映模型槽位", async () => {
		const slots = {
			titleSuffix: "介紹",
			subtitle: "副标题",
			intro: "引子",
			highlights: "看点",
		};
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts: FACTS,
			fetchFn: mockFetch(slotsReply(slots)),
			...base,
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			// anti-false-green:新生成的草稿必须带 slots
			expect(res.slots).toBeDefined();
			expect(res.slots?.intro).toBe("引子");
			expect(res.slots?.highlights).toBe("看点");
			expect(res.slots?.titleSuffix).toBe("介紹");
		}
	});

	it("content 带 ```json 围栏也能解析", async () => {
		const content = '```json\n{"intro":"I","highlights":"H"}\n```';
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts: FACTS,
			fetchFn: mockFetch(oaiReply(content)),
			...base,
		});
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.draft.body).toContain("<p>I</p>");
	});

	it("模型返回旧式 body 字段 → 忽略,只取槽位组装(向后容错 + 防注入)", async () => {
		const content = JSON.stringify({
			body: "<script>x</script>编造正文",
			intro: "真引子",
			highlights: "h",
		});
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts: FACTS,
			fetchFn: mockFetch(oaiReply(content)),
			...base,
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.draft.body).not.toContain("编造正文");
			expect(res.draft.body).not.toContain("<script>");
			expect(res.draft.body).toContain("<p>真引子</p>");
		}
	});

	it("零事实 → 全骨架【待补】,仍 ok(不崩溃)", async () => {
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: mockFetch(slotsReply({ intro: "i", highlights: "h" })),
			...base,
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.draft.title).toBe("【待补】");
			expect(res.draft.body).not.toContain("作品名"); // 缺事实 → 不渲染抬头行
			expect(res.draft.tags).toEqual([]);
		}
	});

	it("端点不支持 json_schema(首请求 400)→ 回落 json_object 重试成功", async () => {
		const f = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 400,
				statusText: "Bad Request",
				json: async () => ({}),
			} as Response)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => slotsReply({ intro: "i", highlights: "h" }),
			} as Response);
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts: FACTS,
			fetchFn: f as unknown as typeof fetch,
			...base,
		});
		expect(res.ok).toBe(true);
		expect(f).toHaveBeenCalledTimes(2);
		const firstBody = JSON.parse(
			(f.mock.calls[0]?.[1] as RequestInit).body as string,
		);
		const secondBody = JSON.parse(
			(f.mock.calls[1]?.[1] as RequestInit).body as string,
		);
		expect(firstBody.response_format.type).toBe("json_schema");
		expect(secondBody.response_format.type).toBe("json_object");
	});

	it("回落后仍 400 → network 错误", async () => {
		const f = mockFetch(
			{},
			{ ok: false, status: 400, statusText: "Bad Request" },
		);
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: f,
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.kind).toBe("network");
		expect(f).toHaveBeenCalledTimes(2);
	});

	it("未配置 key/endpoint → no-key,不发请求", async () => {
		const f = mockFetch(oaiReply("{}"));
		const res = await generateDraft("主题", {
			settings: { ...settings },
			apiKey: "",
			fetchFn: f,
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.kind).toBe("no-key");
		expect(f).not.toHaveBeenCalled();
	});

	it("endpoint 非 https → 拒绝", async () => {
		const f = mockFetch(oaiReply("{}"));
		const res = await generateDraft("主题", {
			settings: { ...settings, endpoint: "http://insecure.com" },
			apiKey: "k",
			fetchFn: f,
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.kind).toBe("network");
		expect(f).not.toHaveBeenCalled();
	});

	it("4xx/5xx → 结构化 network 错误,不含鉴权信息", async () => {
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: mockFetch(
				{},
				{ ok: false, status: 401, statusText: "Unauthorized" },
			),
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.kind).toBe("network");
			expect(res.error).not.toMatch(/Bearer|apiKey|Authorization/i);
		}
	});

	it("超时(AbortError)→ 可重试网络错误", async () => {
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: mockFetch({}, { throwName: "AbortError" }),
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.kind).toBe("network");
			expect(res.error).toMatch(/超时/);
		}
	});

	it("响应非 OpenAI 结构 → format 错误", async () => {
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: mockFetch({ unexpected: true }),
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.kind).toBe("format");
	});

	it("content 非 JSON → format 错误", async () => {
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: mockFetch(oaiReply("就是一段普通文字,不是 JSON")),
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.kind).toBe("format");
	});

	it("res.json() 抛错 → format 错误(响应体非 JSON)", async () => {
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: mockFetch(null, { throwJson: true }),
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.kind).toBe("format");
	});

	it("非 AbortError 的 fetch 异常 → 通用网络错误", async () => {
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: mockFetch({}, { throwName: "TypeError" }),
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.kind).toBe("network");
			expect(res.error).toMatch(/网络错误/);
			expect(res.error).not.toMatch(/超时/);
		}
	});

	it("content 是合法 JSON 但非对象(标量/数组)→ format 错误", async () => {
		const scalar = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: mockFetch(oaiReply('"只是字符串"')),
			...base,
		});
		expect(scalar.ok).toBe(false);
		if (!scalar.ok) expect(scalar.kind).toBe("format");
		const arr = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn: mockFetch(oaiReply("[1,2,3]")),
			...base,
		});
		expect(arr.ok).toBe(false);
		if (!arr.ok) expect(arr.kind).toBe("format");
	});

	it("畸形 endpoint URL → network,且不发请求", async () => {
		const f = mockFetch(oaiReply("{}"));
		const res = await generateDraft("主题", {
			settings: { ...settings, endpoint: "not a url" },
			apiKey: "k",
			fetchFn: f,
			...base,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.kind).toBe("network");
		expect(f).not.toHaveBeenCalled();
	});
});

describe("buildRequest", () => {
	it("注入 Bearer 鉴权头与 JSON body", () => {
		const { url, init } = buildRequest("hi", settings, "secret");
		expect(url).toBe(settings.endpoint);
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer secret",
		);
		expect(JSON.parse(init.body as string).model).toBe("gpt-4o-mini");
	});
});

describe("slotsFromParsed", () => {
	it("抽叙事槽位、忽略 body 字段", () => {
		const s = slotsFromParsed({
			intro: "I",
			highlights: "H",
			titleSuffix: "介紹",
			body: "应被忽略",
		});
		expect(s).toEqual({
			intro: "I",
			highlights: "H",
			titleSuffix: "介紹",
			subtitle: undefined,
			outro: undefined,
		});
	});
	it("null/缺失 → 安全降级", () => {
		const s = slotsFromParsed({ intro: null, subtitle: "" });
		expect(s.intro).toBe("");
		expect(s.subtitle).toBeUndefined();
	});
});

describe("toDraft", () => {
	it("组合 assembled + category/tags + 非 AI 默认值", () => {
		const assembled = assembleDraft(
			{ intro: "B", highlights: "" },
			{ 作品名: "T" },
		);
		const d = toDraft(assembled, "3", ["a"], "id1", "2026-06-03T00:00:00.000Z");
		expect(d.title).toBe("T");
		expect(d.body).toContain("<p>B</p>");
		expect(d.category).toBe("3");
		expect(d.tags).toEqual(["a"]);
		expect(d.postStatus).toBe("0");
		expect(d.status).toBe("draft");
		expect(d.id).toBe("id1");
		expect(d.createdAt).toBe("2026-06-03T00:00:00.000Z");
	});
});

// ---- 429/503 退避重试(Theme E PR-E4)----
function seqFetch(steps: Array<{ status: number; payload?: unknown }>) {
	let i = 0;
	return vi.fn(async () => {
		const step = steps[Math.min(i, steps.length - 1)];
		i += 1;
		return {
			ok: step.status >= 200 && step.status < 300,
			status: step.status,
			statusText: String(step.status),
			headers: { get: () => null },
			json: async () => step.payload ?? {},
		} as unknown as Response;
	});
}

const noSleep = async () => {};

describe("generateDraft 429/5xx 退避重试", () => {
	it("Happy:429 一次后 200 → 重试成功,sleep 被调用一次", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = seqFetch([
			{ status: 429 },
			{ status: 200, payload: slotsReply({ intro: "i", highlights: "h" }) },
		]);
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts: FACTS,
			fetchFn,
			sleep,
			maxRetries: 2,
			...base,
		});
		expect(res.ok).toBe(true);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it("Error:持续 429 超过 maxRetries → 退避耗尽,sleep 调用 maxRetries 次,最终 ok:false", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = seqFetch([{ status: 429 }]);
		const res = await generateDraft("主题", {
			settings, // 无 fallbackModel → 单 model;内层 schema 两轮各自重试
			apiKey: "k",
			fetchFn,
			sleep,
			maxRetries: 2,
			...base,
		});
		expect(res.ok).toBe(false);
		// 单 model(无 fallback);429 在退避耗尽后 break 出 schema 循环(不试 useSchema=false)。
		// 故仅 useSchema=true 一轮:1 初次 + maxRetries(2) 重试 = 2 次 sleep。
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("分桶:400(gemma4 schema 不稳)→ 不重试,走 schema 降级", async () => {
		const sleep = vi.fn(noSleep);
		// schema 轮 400 → 降级到非 schema 轮 200。
		const fetchFn = seqFetch([
			{ status: 400 },
			{ status: 200, payload: slotsReply({ intro: "i", highlights: "h" }) },
		]);
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts: FACTS,
			fetchFn,
			sleep,
			maxRetries: 2,
			...base,
		});
		expect(res.ok).toBe(true);
		expect(sleep).not.toHaveBeenCalled(); // 400 不进退避桶
	});
});

describe("callLlmForJson(review/rewrite)429/5xx 退避 + 不-throw 契约", () => {
	const MIN_DRAFT = {
		id: "d1",
		title: "T",
		subtitle: "",
		category: "2",
		coverImageUrl: "",
		body: "<p>b</p>",
		tags: [],
		description: "",
		postStatus: "0",
		publishedAt: "2026-06-04",
		mediaId: "1",
		status: "draft",
		createdAt: "2026-06-04T00:00:00.000Z",
	} as unknown as Parameters<typeof reviewDraftLlm>[0];

	it("分桶:200 + 非法 JSON(gemma4 格式)→ 立即 ok:false,不重试", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = seqFetch([{ status: 200, payload: oaiReply("不是JSON") }]);
		const res = await reviewDraftLlm(MIN_DRAFT, undefined, {
			settings,
			apiKey: "k",
			fetchFn,
			sleep,
			maxRetries: 2,
			...base,
		});
		expect(res.ok).toBe(false);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("持续 5xx → 重试耗尽返 ok:false、不 throw", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = seqFetch([{ status: 503 }]);
		let result: Awaited<ReturnType<typeof reviewDraftLlm>> | undefined;
		await expect(
			(async () => {
				result = await reviewDraftLlm(MIN_DRAFT, undefined, {
					settings,
					apiKey: "k",
					fetchFn,
					sleep,
					maxRetries: 2,
					...base,
				});
			})(),
		).resolves.toBeUndefined();
		expect(result?.ok).toBe(false);
		expect(sleep).toHaveBeenCalledTimes(2);
	});
});
