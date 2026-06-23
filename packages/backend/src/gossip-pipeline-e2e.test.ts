// U6 — 端到端回归锁定:from-url 时间窗/验证关/拒绝 → 人工 verified → 题材过滤。
// 真 verifyCrawledTopic（no-mock gate，learning #12）+ 真 pending-store（临时 DB）;
// 只 mock 外部网络(fetchContent)与 LLM(gossipExtractFacts)。守护「不发布/不写回」。
//
// E1 稳定化：
//   - vi.useFakeTimers({ toFake:["Date"] })：只伪造 Date，不碰 setTimeout/setImmediate，
//     避免 Fastify 关闭时 app.close() 因 setImmediate 被 fake 而挂起。
//   - vi.setSystemTime(PINNED_NOW)：让测试代码与生产窗口检查（gossip-routes.ts Date.now()）
//     看同一个固定时刻，消除跨日边界 flaky。
//   - env save/restore：beforeEach 存 LLM_* 原值，afterEach 无条件还原，防跨测试污染。
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, initPendingDb, resetPendingDb } from "./scraper/pending-db.js";

// 固定「现在」：选离任何月末/跨年边界足够远的时刻，消除窗口 flaky。
const PINNED_NOW = new Date("2026-01-15T12:00:00Z");

vi.mock("./scraper/adapters/generic-adapter.js", () => ({
	fetchListPaged: vi.fn(),
	fetchContent: vi.fn(),
}));
vi.mock("./scraper/gossip-fact-extractor.js", () => ({
	gossipExtractFacts: vi.fn(),
}));

import { registerGossipRoutes } from "./routes/gossip-routes.js";
import { registerPendingRoutes } from "./routes/pending-routes.js";
import { fetchContent } from "./scraper/adapters/generic-adapter.js";
import { gossipExtractFacts } from "./scraper/gossip-fact-extractor.js";

const mockFetchContent = vi.mocked(fetchContent);
const mockExtract = vi.mocked(gossipExtractFacts);

const LONG_BODY =
	"據知情人爆料，藝人周杰倫近日傳出新消息。起因是被拍到現身機場，經過中工作室回應，" +
	"結果證實只是普通行程。內容充足，超過最小長度門檻，僅供端到端測試使用，並無實際八卦意義。";

function gossipFacts(熱度標籤: string) {
	return {
		facts: {
			當事人: "周杰倫",
			事件摘要: "傳出新消息",
			起因: "被拍到現身機場",
			經過: "工作室回應",
			結果: "證實普通行程",
			來源連結: null,
			發生時間: null,
			熱度標籤,
		},
		confidence: 0.8,
		extractionMode: "strict" as const,
	};
}

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	await registerGossipRoutes(app);
	await registerPendingRoutes(app);
	await app.ready();
	return app;
}

let app: FastifyInstance;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
	// E1: 存原值，设置固定时钟（只 fake Date），固定「现在」。
	savedEnv = {
		LLM_ENDPOINT: process.env.LLM_ENDPOINT,
		LLM_API_KEY: process.env.LLM_API_KEY,
	};
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(PINNED_NOW);

	resetPendingDb();
	initPendingDb();
	getDb().exec("DELETE FROM pending_topics");
	vi.clearAllMocks();
	process.env.LLM_ENDPOINT = "https://api.test";
	process.env.LLM_API_KEY = "test-key";
	app = await buildApp();
});

afterEach(async () => {
	// E1: 先还原真实 Date（Fastify close 内部依赖真实计时），再关 app，再还原 env。
	vi.useRealTimers();
	await app.close();
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

async function fromUrl(url: string, windowDays?: number) {
	return app.inject({
		method: "POST",
		url: "/api/v1/gossip/topics/from-url",
		payload: { url, siteName: "站", ...(windowDays ? { windowDays } : {}) },
	});
}

describe("U6 端到端:发现→窗口→验证→核对→题材", () => {
	it("完整闭环:有效新瓜入池 → 旧瓜跳过 → 无效拒绝 → 核对进题材池 → 题材过滤命中", async () => {
		const recent = new Date(PINNED_NOW.getTime() - 2 * 86_400_000).toISOString();

		// 1) 有效窗内瓜 → 入池(带 verification + 指纹)
		mockFetchContent.mockResolvedValueOnce({
			title: "周杰倫新瓜",
			body: LONG_BODY,
			url: "https://gossip.com/a",
			metadata: { publishedTime: recent },
		});
		mockExtract.mockResolvedValueOnce(gossipFacts("出軌"));
		const a = await fromUrl("https://gossip.com/a", 30);
		expect(a.statusCode).toBe(201);
		const topicId = a.json().topic.id as string;
		expect(a.json().topic.verification).toBeDefined();
		expect(a.json().topic.contentFingerprint).toBeTruthy();

		// 2) 旧瓜(窗外)→ 200 skipped、不入池、不调 LLM
		mockFetchContent.mockResolvedValueOnce({
			title: "旧瓜",
			body: LONG_BODY,
			url: "https://gossip.com/old",
			metadata: { publishedTime: "2020-01-01T00:00:00.000Z" },
		});
		const old = await fromUrl("https://gossip.com/old", 7);
		expect(old.statusCode).toBe(200);
		expect(old.json().skipped).toBe("too-old");

		// 3) 无效内容(正文过短)→ 200 rejected、不入池
		mockFetchContent.mockResolvedValueOnce({
			title: "无效",
			body: "短",
			url: "https://gossip.com/bad",
		});
		mockExtract.mockResolvedValueOnce(gossipFacts("解約"));
		const bad = await fromUrl("https://gossip.com/bad", 30);
		expect(bad.statusCode).toBe(200);
		expect(bad.json().rejected).toBeTruthy();

		// 入池的只有第 1 条
		const allPending = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics?domain=gossip",
		});
		expect((allPending.json().topics as unknown[]).length).toBe(1);

		// 4) 核对前:题材池为空(verified=true 无命中)
		const beforeThemes = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics/themes",
		});
		expect((beforeThemes.json().themes as unknown[]).length).toBe(0);

		// 5) 人工核对 → 置 verifiedAt
		const verify = await app.inject({
			method: "PATCH",
			url: `/api/v1/pending-topics/${topicId}`,
			payload: { verified: true },
		});
		expect(verify.statusCode).toBe(200);
		expect(verify.json().topic.verifiedAt).toBeTruthy();

		// 6) 题材池出现「出軌」计数;按题材过滤命中该条
		const themes = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics/themes",
		});
		const themeMap = Object.fromEntries(
			(themes.json().themes as { theme: string; count: number }[]).map((t) => [
				t.theme,
				t.count,
			]),
		);
		expect(themeMap.出軌).toBe(1);

		const filtered = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics?domain=gossip&theme=出軌&verified=true",
		});
		expect(
			(filtered.json().topics as { id: string }[]).map((t) => t.id),
		).toEqual([topicId]);
	});

	it("内容指纹跨 URL:同 facts 不同 URL → 第二条软标 suspectedDuplicate 入池(非静默丢)", async () => {
		const recent = new Date(PINNED_NOW.getTime() - 86_400_000).toISOString();
		for (const u of ["https://gossip.com/d1", "https://gossip.com/d2"]) {
			mockFetchContent.mockResolvedValueOnce({
				title: "同瓜",
				body: LONG_BODY,
				url: u,
				metadata: { publishedTime: recent },
			});
			mockExtract.mockResolvedValueOnce(gossipFacts("出軌"));
		}
		const first = await fromUrl("https://gossip.com/d1", 30);
		expect(first.statusCode).toBe(201);
		const second = await fromUrl("https://gossip.com/d2", 30);
		expect(second.statusCode).toBe(201);
		expect(second.json().topic.verification.suspectedDuplicate).toBe(true);
		// 两条都入池(可见可恢复),非静默合并
		const all = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics?domain=gossip",
		});
		expect((all.json().topics as unknown[]).length).toBe(2);
	});

	it("回归守护:从 from-url 到 pending 全程无 publish/runBatch/写回路径", async () => {
		// 结构性断言:gossip + pending 路由表里无任何 publish/batch/fill 端点。
		const routes = app.printRoutes();
		expect(routes).not.toMatch(/publish|batch|fill|runBatch/i);
	});
});
