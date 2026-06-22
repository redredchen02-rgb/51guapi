import cron from "node-cron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractFacts } from "./fact-extractor.js";
import {
	type PendingTopic,
	pendingTopicExistsBySourceUrl,
	savePendingTopic,
} from "./pending-store.js";
import { startScheduler } from "./scheduler.js";
import { scraperConfig } from "./scraper-config.js";
import type { RawContent, SiteAdapter } from "./site-adapter.js";

// ---- mocks ----

// mock node-cron：捕获 schedule 注册的任务回调，测试中手动 await 触发
vi.mock("node-cron", () => ({
	default: {
		validate: vi.fn(() => true),
		schedule: vi.fn(() => ({ stop: vi.fn() })),
	},
}));

vi.mock("./fact-extractor.js", () => ({
	extractFacts: vi.fn(),
}));

vi.mock("./pending-store.js", () => ({
	savePendingTopic: vi.fn(async () => ({ inserted: true })),
	pendingTopicExistsBySourceUrl: vi.fn(async () => false),
}));

vi.mock("../services/telegram.js", () => ({
	sendAlert: vi.fn(async () => undefined),
}));

vi.mock("./channel-store.js", () => ({
	getChannelByHostname: vi.fn(() => null),
}));

// ---- helpers ----

const MOCK_RAW: RawContent = {
	title: "测试文章",
	body: "正文内容",
	url: "https://test-site.example.com/article/1",
};

function makeMockAdapter(name: string): SiteAdapter {
	return {
		name,
		fetchContent: vi.fn(async (_url: string): Promise<RawContent> => MOCK_RAW),
	};
}

const DEPS = {
	llmEndpoint: "https://llm.example.com/v1/chat/completions",
	llmApiKey: "test-key",
	llmModel: "test-model",
};

// scraperConfig 与 scheduler 的 jobs Map 均为模块单例：
// 每个用例用自增唯一 siteName 防跨用例污染（旧站点因 jobs.has 被跳过，不重复 schedule）
let testId = 0;
let currentSite: string;
let currentUrl: string;

/** 注册唯一站点并启动 scheduler，返回本用例注册的 cron 任务回调。 */
function startAndGetJob(): () => Promise<void> {
	scraperConfig.registerAdapter(makeMockAdapter(`sched-adapter-${testId}`));
	scraperConfig.addSiteConfig({
		siteName: currentSite,
		adapterName: `sched-adapter-${testId}`,
		url: currentUrl,
		cron: "0 * * * *",
		enabled: true,
	});
	startScheduler(DEPS);
	// beforeEach 已清空 mock 调用记录，旧站点被 jobs.has 跳过，本用例只产生一次 schedule 调用
	const calls = vi.mocked(cron.schedule).mock.calls;
	expect(calls).toHaveLength(1);
	return calls[0][1] as () => Promise<void>;
}

function savedTopic(): PendingTopic {
	const calls = vi.mocked(savePendingTopic).mock.calls;
	expect(calls).toHaveLength(1);
	return calls[0][0];
}

beforeEach(() => {
	vi.clearAllMocks();
	testId++;
	currentSite = `sched-site-${testId}`;
	currentUrl = `https://test-site.example.com/list/${testId}`;
});

afterEach(() => {
	vi.clearAllMocks();
});

// ================================================================
// coverImageUrl 透传（与手动 trigger 路径行为一致）
// ================================================================

describe("startScheduler — cron 任务的 coverImageUrl 透传", () => {
	it("extractFacts 返回 coverImageUrl → savePendingTopic 收到同值 coverImageUrl", async () => {
		vi.mocked(extractFacts).mockResolvedValue({
			facts: { 作品名: "测试作品" },
			confidence: 0.85,
			coverImageUrl: "https://cdn.example.com/cover.jpg",
			extractionMode: "strict",
		});

		const job = startAndGetJob();
		await job();

		expect(savedTopic().coverImageUrl).toBe(
			"https://cdn.example.com/cover.jpg",
		);
	});

	it("extractFacts 无 coverImageUrl → topic 不含该字段（条件展开不产生键）", async () => {
		vi.mocked(extractFacts).mockResolvedValue({
			facts: { 作品名: "测试作品" },
			confidence: 0.85,
			coverImageUrl: undefined,
			extractionMode: "strict",
		});

		const job = startAndGetJob();
		await job();

		expect(savedTopic()).not.toHaveProperty("coverImageUrl");
	});

	it("topic 其余字段正确（sourceUrl、siteName、title、facts、confidence、status）", async () => {
		vi.mocked(extractFacts).mockResolvedValue({
			facts: { 作品名: "测试作品" },
			confidence: 0.85,
			coverImageUrl: undefined,
			extractionMode: "strict",
		});

		const job = startAndGetJob();
		await job();

		const topic = savedTopic();
		expect(topic).toMatchObject({
			sourceUrl: currentUrl,
			siteName: currentSite,
			title: MOCK_RAW.title,
			facts: { 作品名: "测试作品" },
			confidence: 0.85,
			status: "pending",
		});
	});

	it("extractFacts reject → 不调用 savePendingTopic，错误被吞不外抛", async () => {
		vi.mocked(extractFacts).mockRejectedValue(new Error("LLM down"));

		const job = startAndGetJob();
		await expect(job()).resolves.toBeUndefined();

		expect(savePendingTopic).not.toHaveBeenCalled();
	});

	it("url 为空的启用站点被跳过，不注册 cron 任务（纵深防御）", () => {
		scraperConfig.registerAdapter(makeMockAdapter(`sched-adapter-${testId}`));
		scraperConfig.addSiteConfig({
			siteName: currentSite,
			adapterName: `sched-adapter-${testId}`,
			url: "",
			cron: "0 * * * *",
			enabled: true,
		});
		startScheduler(DEPS);

		expect(vi.mocked(cron.schedule).mock.calls).toHaveLength(0);
	});
});

// ================================================================
// U4: list-discovery 模式
// ================================================================

import { sendAlert } from "../services/telegram.js";

const LIST_URL = "https://test-site.example.com/list/";

function makeFetchListAdapter(name: string, urls: string[]): SiteAdapter {
	return {
		name,
		fetchContent: vi.fn(async (_url: string): Promise<RawContent> => MOCK_RAW),
		fetchList: vi.fn(async () => urls),
	};
}

function startListJob(
	listUrls: string[],
	budgetOverride?: string,
): () => Promise<void> {
	if (budgetOverride !== undefined)
		process.env.SCRAPER_LIST_BUDGET = budgetOverride;
	scraperConfig.registerAdapter(
		makeFetchListAdapter(`list-adapter-${testId}`, listUrls),
	);
	scraperConfig.addSiteConfig({
		siteName: currentSite,
		adapterName: `list-adapter-${testId}`,
		url: currentUrl,
		listUrl: LIST_URL,
		cron: "0 * * * *",
		enabled: true,
	});
	startScheduler(DEPS);
	const calls = vi.mocked(cron.schedule).mock.calls;
	expect(calls).toHaveLength(1);
	return calls[0][1] as () => Promise<void>;
}

describe("startScheduler — list-discovery mode (U4)", () => {
	beforeEach(() => {
		delete process.env.SCRAPER_LIST_BUDGET;
		// clearAllMocks does not reset implementations; explicitly restore defaults here
		vi.mocked(pendingTopicExistsBySourceUrl).mockResolvedValue(false);
		vi.mocked(savePendingTopic).mockResolvedValue({ inserted: true });
		vi.mocked(extractFacts).mockResolvedValue({
			facts: { 作品名: "测试作품" },
			confidence: 0.85,
			coverImageUrl: undefined,
			extractionMode: "strict",
		});
	});

	it("3 个新 URL → fetchContent 调用 3 次，savePendingTopic 调用 3 次", async () => {
		const urls = [
			"https://test-site.example.com/acg/1",
			"https://test-site.example.com/acg/2",
			"https://test-site.example.com/acg/3",
		];
		const job = startListJob(urls);
		await job();

		expect(vi.mocked(savePendingTopic).mock.calls).toHaveLength(3);
	});

	it("budget cap: 5 个 URL，budget=3 → 只处理 3 条", async () => {
		const urls = Array.from(
			{ length: 5 },
			(_, i) => `https://test-site.example.com/acg/${i + 1}`,
		);
		const job = startListJob(urls, "3");
		await job();

		expect(vi.mocked(savePendingTopic).mock.calls).toHaveLength(3);
		delete process.env.SCRAPER_LIST_BUDGET;
	});

	it("session set 去重：同一 URL 出现两次，fetchContent 只调用一次", async () => {
		const url = "https://test-site.example.com/acg/dup";
		const job = startListJob([url, url]);
		await job();

		expect(vi.mocked(savePendingTopic).mock.calls).toHaveLength(1);
	});

	it("DB 去重：URL 已在 pending_topics → fetchContent 不调用", async () => {
		vi.mocked(pendingTopicExistsBySourceUrl).mockResolvedValue(true);
		const job = startListJob(["https://test-site.example.com/acg/existing"]);
		await job();

		expect(vi.mocked(savePendingTopic)).not.toHaveBeenCalled();
	});

	it("fetchContent 连续失败 3 次 → sendAlert 调用一次", async () => {
		const adapterName = `fail-adapter-${testId}`;
		const failAdapter: SiteAdapter = {
			name: adapterName,
			fetchContent: vi.fn(async () => {
				throw new Error("network error");
			}),
			fetchList: vi.fn(async () => [
				"https://test-site.example.com/acg/f1",
				"https://test-site.example.com/acg/f2",
				"https://test-site.example.com/acg/f3",
			]),
		};
		scraperConfig.registerAdapter(failAdapter);
		scraperConfig.addSiteConfig({
			siteName: currentSite,
			adapterName,
			url: currentUrl,
			listUrl: LIST_URL,
			cron: "0 * * * *",
			enabled: true,
		});
		startScheduler(DEPS);
		const calls = vi.mocked(cron.schedule).mock.calls;
		const job = calls[0][1] as () => Promise<void>;
		await job();

		expect(vi.mocked(sendAlert)).toHaveBeenCalledOnce();
		expect(vi.mocked(sendAlert).mock.calls[0][0]).toContain(
			"consecutive fetch failures",
		);
	});

	it("adapter 无 fetchList → 走单条 URL 路径（回退，不回归）", async () => {
		const job = startAndGetJob(); // uses makeMockAdapter without fetchList
		await job();

		// single-URL path: savePendingTopic called once with site.url as sourceUrl
		expect(vi.mocked(savePendingTopic).mock.calls).toHaveLength(1);
		expect(vi.mocked(savePendingTopic).mock.calls[0][0].sourceUrl).toBe(
			currentUrl,
		);
	});
});

// ================================================================
// U2: maxDepth 驱动翻页（scheduler 路径）
// ================================================================

import { getChannelByHostname } from "./channel-store.js";

function makePagedAdapter(
	name: string,
	paged: (listUrl: string, maxPages: number) => Promise<string[]>,
	listFallback: string[] = [],
): SiteAdapter {
	return {
		name,
		fetchContent: vi.fn(async (_url: string): Promise<RawContent> => MOCK_RAW),
		fetchList: vi.fn(async () => listFallback),
		fetchListPaged: paged,
	};
}

function startPagedJob(adapter: SiteAdapter): () => Promise<void> {
	scraperConfig.registerAdapter(adapter);
	scraperConfig.addSiteConfig({
		siteName: currentSite,
		adapterName: adapter.name,
		url: currentUrl,
		listUrl: LIST_URL,
		cron: "0 * * * *",
		enabled: true,
	});
	startScheduler(DEPS);
	const calls = vi.mocked(cron.schedule).mock.calls;
	expect(calls).toHaveLength(1);
	return calls[0][1] as () => Promise<void>;
}

describe("startScheduler — maxDepth drives pagination (U2)", () => {
	beforeEach(() => {
		delete process.env.SCRAPER_LIST_BUDGET;
		vi.mocked(getChannelByHostname).mockReturnValue(null);
		vi.mocked(pendingTopicExistsBySourceUrl).mockResolvedValue(false);
		vi.mocked(savePendingTopic).mockResolvedValue({ inserted: true });
		vi.mocked(extractFacts).mockResolvedValue({
			facts: { 作品名: "测试" },
			confidence: 0.85,
			coverImageUrl: undefined,
			extractionMode: "strict",
		});
	});

	it("Happy：渠道 maxDepth=3 → fetchListPaged 以 maxPages=3 调用", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: 测试桩仅取 maxDepth 字段
		vi.mocked(getChannelByHostname).mockReturnValue({ maxDepth: 3 } as any);
		const paged = vi.fn(async () => [
			"https://test-site.example.com/acg/1",
			"https://test-site.example.com/acg/2",
		]);
		const adapter = makePagedAdapter(`paged-3-${testId}`, paged);
		await startPagedJob(adapter)();

		expect(paged).toHaveBeenCalledWith(LIST_URL, 3);
		expect(vi.mocked(savePendingTopic).mock.calls).toHaveLength(2);
	});

	it("无渠道记录 → maxPages=1（单页退化，不回归）", async () => {
		vi.mocked(getChannelByHostname).mockReturnValue(null);
		const paged = vi.fn(async () => ["https://test-site.example.com/acg/1"]);
		const adapter = makePagedAdapter(`paged-default-${testId}`, paged);
		await startPagedJob(adapter)();

		expect(paged).toHaveBeenCalledWith(LIST_URL, 1);
	});

	it("adapter 仅有 fetchList（无 fetchListPaged）→ 回退单页，不回归", async () => {
		// 复用 U4 的 fetchList-only adapter：不应崩，按单页处理
		const job = startListJob(["https://test-site.example.com/acg/legacy"]);
		await job();
		expect(vi.mocked(savePendingTopic).mock.calls).toHaveLength(1);
	});

	it("Edge：多页累积结果仍受 SCRAPER_LIST_BUDGET 封顶", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: 测试桩仅取 maxDepth 字段
		vi.mocked(getChannelByHostname).mockReturnValue({ maxDepth: 5 } as any);
		const urls = Array.from(
			{ length: 10 },
			(_, i) => `https://test-site.example.com/acg/${i + 1}`,
		);
		const paged = vi.fn(async () => urls);
		process.env.SCRAPER_LIST_BUDGET = "3";
		const adapter = makePagedAdapter(`paged-budget-${testId}`, paged);
		await startPagedJob(adapter)();

		expect(paged).toHaveBeenCalledWith(LIST_URL, 5);
		expect(vi.mocked(savePendingTopic).mock.calls).toHaveLength(3);
		delete process.env.SCRAPER_LIST_BUDGET;
	});
});
