import type { ContentDraft, Settings } from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
import {
	generateDraft,
	listModels,
	mergeRewriteResult,
	reviewDraft,
	rewriteDraft,
} from "./llm";

vi.mock("./auth-client", () => ({
	getToken: vi.fn(async () => null),
	clearToken: vi.fn(async () => {}),
}));

function mockFetch(
	payload: unknown,
	init?: {
		ok?: boolean;
		status?: number;
		statusText?: string;
		throwName?: string;
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
			json: async () => payload,
			text: async () => JSON.stringify(payload),
		} as Response;
	});
}

const settings: Settings = {
	endpoint: "http://127.0.0.1:3001",
	model: "gpt-4o-mini",
	fallbackModel: "",
	promptTemplate: "test template",
	fewShotPairs: [],
	fieldMapping: {},
};

describe("Extension LLM client proxy", () => {
	it("generateDraft forwards options to backend server", async () => {
		const fakeDraft = { id: "draft_1", title: "hello", body: "body content" };
		const f = mockFetch({ ok: true, draft: fakeDraft });

		const res = await generateDraft("hi", {
			settings,
			apiKey: "",
			facts: {},
			fetchFn: f,
		});

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.draft.title).toBe("hello");
		}
		expect(f).toHaveBeenCalledWith(
			"http://127.0.0.1:3001/api/v1/drafts/generate",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					prompt: "hi",
					settings,
					facts: {},
				}),
			}),
		);
	});

	it("generateDraft passes slots through from the backend response", async () => {
		const fakeDraft = { id: "draft_1", title: "hello", body: "body content" };
		const fakeSlots = {
			intro: "开场",
			highlights: "看点",
			subtitle: "副标题",
		};
		const f = mockFetch({ ok: true, draft: fakeDraft, slots: fakeSlots });

		const res = await generateDraft("hi", {
			settings,
			apiKey: "",
			facts: {},
			fetchFn: f,
		});

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.slots).toEqual(fakeSlots);
		}
	});

	it("generateDraft tolerates a response without slots (legacy)", async () => {
		const fakeDraft = { id: "draft_1", title: "hello", body: "body content" };
		const f = mockFetch({ ok: true, draft: fakeDraft });

		const res = await generateDraft("hi", {
			settings,
			apiKey: "",
			facts: {},
			fetchFn: f,
		});

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.slots).toBeUndefined();
		}
	});

	it("generateDraft returns error when backend returns non-ok response", async () => {
		const f = mockFetch({ error: "Backend error" }, { ok: false, status: 500 });

		const res = await generateDraft("hi", {
			settings,
			apiKey: "",
			facts: {},
			fetchFn: f,
		});

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toBe("Backend error");
		}
	});

	it("listModels calls backend list models endpoint", async () => {
		const f = mockFetch({ ok: true, models: ["model-1", "model-2"] });

		const res = await listModels("http://127.0.0.1:3001", "", f);

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.models).toEqual(["model-1", "model-2"]);
		}
		expect(f).toHaveBeenCalledWith(
			"http://127.0.0.1:3001/api/v1/models",
			expect.objectContaining({
				headers: { "Content-Type": "application/json" },
			}),
		);
	});
});

const draft: ContentDraft = {
	id: "d1",
	title: "测试标题",
	subtitle: "",
	category: "2",
	coverImageUrl: "",
	body: "<p>测试正文</p>",
	tags: ["标签A"],
	description: "",
	postStatus: "0",
	publishedAt: "",
	mediaId: "99",
	status: "draft",
	createdAt: "2026-06-11T00:00:00.000Z",
};

const deps = { settings, apiKey: "" };

describe("reviewDraft proxy", () => {
	it("happy path: 返回 ok:true + result", async () => {
		const payload = {
			ok: true,
			result: { ok: true, dimensions: [{ name: "body_richness", pass: true }] },
		};
		const f = mockFetch(payload);
		const res = await reviewDraft(draft, undefined, { ...deps, fetchFn: f });
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.result.dimensions?.[0]?.name).toBe("body_richness");
		expect(f).toHaveBeenCalledWith(
			"http://127.0.0.1:3001/api/v1/drafts/review",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("网络失败 → ok:false kind:network", async () => {
		const f = mockFetch({}, { throwName: "TypeError" });
		const res = await reviewDraft(draft, undefined, { ...deps, fetchFn: f });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.kind).toBe("network");
	});

	it("后端 500 → ok:false", async () => {
		const f = mockFetch({ error: "server error" }, { ok: false, status: 500 });
		const res = await reviewDraft(draft, undefined, { ...deps, fetchFn: f });
		expect(res.ok).toBe(false);
	});

	it("401 → 清 token + ok:false", async () => {
		const { clearToken } = await import("./auth-client");
		const f = mockFetch({}, { ok: false, status: 401 });
		const res = await reviewDraft(draft, undefined, { ...deps, fetchFn: f });
		expect(res.ok).toBe(false);
		expect(clearToken).toHaveBeenCalled();
	});
});

describe("rewriteDraft proxy", () => {
	it("happy path: 返回 ok:true + draft", async () => {
		const rewritten = { ...draft, title: "新标题" };
		const payload = { ok: true, draft: rewritten };
		const f = mockFetch(payload);
		const res = await rewriteDraft(draft, ["title_quality"], {
			...deps,
			fetchFn: f,
		});
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.draft.title).toBe("新标题");
		expect(f).toHaveBeenCalledWith(
			"http://127.0.0.1:3001/api/v1/drafts/rewrite",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("后端失败 → ok:false", async () => {
		const f = mockFetch({}, { ok: false, status: 422 });
		const res = await rewriteDraft(draft, ["body_richness"], {
			...deps,
			fetchFn: f,
		});
		expect(res.ok).toBe(false);
	});
});

describe("mergeRewriteResult", () => {
	const rewrite: Partial<ContentDraft> = {
		title: "重写标题",
		body: "<p>重写正文</p>",
		tags: ["新标签"],
	};

	it("title_quality 失败 → title 来自 rewrite", () => {
		const r = mergeRewriteResult(draft, rewrite, ["title_quality"]);
		expect(r.title).toBe("重写标题");
		expect(r.body).toBe(draft.body); // 未改
	});

	it("body_richness 失败 → body 来自 rewrite", () => {
		const r = mergeRewriteResult(draft, rewrite, ["body_richness"]);
		expect(r.body).toBe("<p>重写正文</p>");
		expect(r.title).toBe(draft.title); // 未改
	});

	it("community_tone 失败 → body 来自 rewrite", () => {
		const r = mergeRewriteResult(draft, rewrite, ["community_tone"]);
		expect(r.body).toBe("<p>重写正文</p>");
	});

	it("category_accuracy 失败 → tags 来自 rewrite", () => {
		const r = mergeRewriteResult(draft, rewrite, ["category_accuracy"]);
		expect(r.tags).toEqual(["新标签"]);
	});

	it("id / coverImageUrl / mediaId 始终保留 original", () => {
		const r = mergeRewriteResult(
			draft,
			{ ...rewrite, id: "hacked", mediaId: "0" },
			["title_quality"],
		);
		expect(r.id).toBe(draft.id);
		expect(r.mediaId).toBe(draft.mediaId);
		expect(r.coverImageUrl).toBe(draft.coverImageUrl);
	});

	it("rewrite 缺少字段 → 保留 original 对应字段", () => {
		const r = mergeRewriteResult(draft, {}, ["title_quality", "body_richness"]);
		expect(r.title).toBe(draft.title);
		expect(r.body).toBe(draft.body);
	});
});
