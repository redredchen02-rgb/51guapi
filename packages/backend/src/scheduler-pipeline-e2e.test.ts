// @vitest-environment node
//
// E5 — scheduler(cron)自动爬取路径 → 真 pending-store e2e。
// 复用 scheduler.test.ts 的 cron-spy 捕获范式（mock node-cron → 从 schedule spy 取回注册的
// callback → 手动 await，不等真实定时），但**关键差异**：本单元**不 mock pending-store**，让
// savePendingTopic / pendingTopicExistsBySourceUrl 走**真 SQLite 临时 DB**（test-setup 指向临时目录）。
// 只 mock 外部网络（adapter.fetchContent / fetchList，经 scraperConfig 注入）与 LLM（extractFacts）。
//
// 价值：scheduler.test.ts 把 store 整个 mock 掉，从未证「cron 路径真入池、可读回」；本单元补这条
// 跨层覆盖（真入池 + score 计算 + 真 DB 去重），并守护 no-publish。
//
// ⚠️ 已核实的产出分歧（计划 E5「domain='gossip' / 与 from-url 产出一致」之声称不成立，按实改正）：
//   - from-url 路径（gossip-routes.ts:312）：用 gossipExtractFacts，存档显式 domain="gossip"。
//   - scheduler 路径（本单元）：用通用 extractFacts，build topic **不设 domain** → savePendingTopic
//     默认 `domain ?? "acg"`。故 cron 自动爬取入池的是 **domain='acg'**，而吃瓜待审视图过滤
//     domain='gossip' —— cron 发现的选题不会出现在吃瓜池。这是 ACG 时代排程管线未随吃瓜化迁移
//     的真实功能缺口，本单元**特征化（characterize）当前行为**并断言 'acg'，不写假的 'gossip'。
//     修复属生产改动（超出 E5「零生产改动」范围），留作独立 finding 待定。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mock node-cron：捕获 schedule 注册的回调，手动 await（不等真实定时）。
vi.mock("node-cron", () => ({
	default: {
		validate: vi.fn(() => true),
		schedule: vi.fn(() => ({ stop: vi.fn() })),
	},
}));
// mock LLM 提炼出口（scheduler 经 extractFacts，非 gossipExtractFacts）。
vi.mock("./scraper/fact-extractor.js", () => ({
	extractFacts: vi.fn(),
}));
// mock 渠道存储（resolveMaxDepth 会查；返回 null = 单页退化，确定化）。
vi.mock("./scraper/channel-store.js", () => ({
	getChannelByHostname: vi.fn(() => null),
}));
// mock 告警出口，避免真实网络。
vi.mock("./services/telegram.js", () => ({
	sendAlert: vi.fn(async () => undefined),
}));

import cron from "node-cron";
import { extractFacts } from "./scraper/fact-extractor.js";
import { getDb, initPendingDb, resetPendingDb } from "./scraper/pending-db.js";
import { listPendingTopics } from "./scraper/pending-store.js";
import { startScheduler } from "./scraper/scheduler.js";
import { scraperConfig } from "./scraper/scraper-config.js";
import type { RawContent, SiteAdapter } from "./scraper/site-adapter.js";

const DEPS = {
	llmEndpoint: "https://llm.example.com/v1/chat/completions",
	llmApiKey: "test-key",
	llmModel: "test-model",
};

const LONG_BODY =
	"據知情人爆料，藝人近日傳出新消息。起因是被拍到現身機場，經過中工作室回應，" +
	"結果證實只是普通行程。內容充足，僅供端到端測試使用，並無實際八卦意義。";

const MOCK_RAW: RawContent = {
	title: "排程瓜标题",
	body: LONG_BODY,
	url: "https://sched.example.com/article/seed",
};

// scraperConfig / scheduler.jobs 均为模块单例：每用例自增唯一 siteName，旧站点因 jobs.has 被跳过。
let testId = 0;
let currentSite: string;
let currentUrl: string;

// ⚠️ 注意 facts 形状：scheduler 经通用 extractFacts，其 ExtractedFacts.facts 是 **FactsBlock**
// （ACG 形状，如 作品名），**非** gossip 的 GossipFactsBlock（當事人/熱度標籤）。这与 domain='acg'
// 同源——cron 路径端到端是 ACG 时代形状，未随吃瓜化迁移。故此处用 ACG 形状 facts（同 scheduler.test.ts）。
function acgFacts() {
	return {
		facts: { 作品名: "测试作品" },
		confidence: 0.8,
		coverImageUrl: undefined,
		extractionMode: "strict" as const,
	};
}

function singleUrlAdapter(name: string): SiteAdapter {
	return {
		name,
		fetchContent: vi.fn(async (_url: string): Promise<RawContent> => MOCK_RAW),
	};
}

function listAdapter(name: string, urls: string[]): SiteAdapter {
	return {
		name,
		fetchContent: vi.fn(
			async (url: string): Promise<RawContent> => ({ ...MOCK_RAW, url }),
		),
		fetchList: vi.fn(async () => urls),
	};
}

/** 注册站点 + 启动 scheduler，返回**最新**注册的 cron 回调（旧站点被 jobs.has 跳过）。 */
function startAndGetLatestJob(
	adapter: SiteAdapter,
	listUrl?: string,
): () => Promise<void> {
	scraperConfig.registerAdapter(adapter);
	scraperConfig.addSiteConfig({
		siteName: currentSite,
		adapterName: adapter.name,
		url: currentUrl,
		...(listUrl ? { listUrl } : {}),
		cron: "0 * * * *",
		enabled: true,
	});
	startScheduler(DEPS);
	const calls = vi.mocked(cron.schedule).mock.calls;
	return calls[calls.length - 1][1] as () => Promise<void>;
}

beforeEach(() => {
	resetPendingDb();
	initPendingDb();
	getDb().exec("DELETE FROM pending_topics");
	vi.clearAllMocks();
	vi.mocked(extractFacts).mockResolvedValue(acgFacts());
	process.env.LLM_ENDPOINT = "https://api.test";
	process.env.LLM_API_KEY = "test-key";
	testId++;
	currentSite = `e5-site-${testId}`;
	currentUrl = `https://sched.example.com/article/${testId}`;
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("E5 scheduler 单条 URL 路径 → 真 pending-store", () => {
	it("cron 回调 await 一次 → 真入池可读回，字段正确，domain='gossip'", async () => {
		const job = startAndGetLatestJob(singleUrlAdapter(`single-${testId}`));
		await job();

		// 读回走真 listPendingTopics（真 SQLite），证 scheduler.test.ts 的 mock 证不到的真持久化。
		const topics = await listPendingTopics();
		expect(topics).toHaveLength(1);
		const t = topics[0];
		expect(t.sourceUrl).toBe(currentUrl);
		expect(t.siteName).toBe(currentSite);
		expect(t.title).toBe(MOCK_RAW.title);
		expect(t.facts).toMatchObject({ 作品名: "测试作品" });
		expect(t.confidence).toBe(0.8);
		expect(t.status).toBe("pending");
		// score 由真 computeScore 算出（mock 版本拿不到）。
		expect(t.score).toBeGreaterThan(0);
		// scheduler 渠道均为吃瓜站，明确写入 domain='gossip'（已修复默认 'acg' 的 bug）。
		expect(t.domain).toBe("gossip");
		// 未经人工二次核对。
		expect(t.verifiedAt).toBeUndefined();
	});

	it("no-publish：cron 路径只产出 status='pending' 的 pending 行，无自动发布/写回", async () => {
		const job = startAndGetLatestJob(singleUrlAdapter(`single-np-${testId}`));
		await job();
		const topics = await listPendingTopics();
		// 产品全局无 publish sink；scheduler 唯一副作用是 pending_topics 写入、状态恒 'pending'。
		expect(topics.every((t) => t.status === "pending")).toBe(true);
	});
});

describe("E5 scheduler 列表发现路径 → 真 pending-store", () => {
	const U1 = "https://sched.example.com/acg/1001";
	const U2 = "https://sched.example.com/acg/1002";

	it("list 发现两条新 URL → 两条真入池，sourceUrl 各异", async () => {
		const job = startAndGetLatestJob(
			listAdapter(`list-${testId}`, [U1, U2]),
			"https://sched.example.com/list/",
		);
		await job();

		const topics = await listPendingTopics();
		expect(topics).toHaveLength(2);
		expect(new Set(topics.map((t) => t.sourceUrl))).toEqual(new Set([U1, U2]));
		expect(topics.every((t) => t.status === "pending")).toBe(true);
	});

	it("真 DB 去重：URL 已在 pending_topics → 第二轮 list run 不重复入池（证真 pendingTopicExistsBySourceUrl）", async () => {
		// 第一轮：入池 U1、U2。
		const job1 = startAndGetLatestJob(
			listAdapter(`list-d1-${testId}`, [U1, U2]),
			"https://sched.example.com/list/",
		);
		await job1();
		expect(await listPendingTopics()).toHaveLength(2);

		// 第二轮（新站点、相同 URL 集）：真 DB 存在性检查应全部跳过，总数仍 2。
		currentSite = `e5-site-${testId}-b`;
		const job2 = startAndGetLatestJob(
			listAdapter(`list-d2-${testId}`, [U1, U2]),
			"https://sched.example.com/list/",
		);
		await job2();
		expect(await listPendingTopics()).toHaveLength(2);
	});
});

// Anti-false-green（人工验证步骤，不留在仓库）：
//   1) 真入池断言：把 startAndGetLatestJob 里 addSiteConfig 的 url 改成空串 → 站点被
//      startScheduler filter 跳过、无 callback 注册 → calls[last] 取不到 → 用例报错（证回调确由真注册产生）。
//   2) 真 DB 去重断言：临时把第二轮 listAdapter 的 URL 换成全新 U3/U4 → 总数变 4 ≠ 2 → 用例变红
//      （证去重断言真在比对 source_url，而非恒等于 2）。
