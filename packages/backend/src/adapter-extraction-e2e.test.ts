// @vitest-environment node
//
// E4 — 真 adapter HTML 提取 e2e：在 fetch 出口注入「脱敏的擬真 fixture HTML」，跑**真**
// fetchContent / fetchListPaged，端到端覆盖既有单测/inline 片段证不到的提取路径：
//   1. extractContainerText（括号配平抓全巢状容器）—— 既有 ARTICLE_HTML 只有 og:description，
//      正文恒走 og 兜底，从未经 fetchContent 门面验证「容器优先于 og:description」。
//   2. extractByDensity（剥 nav/footer 噪声后聚合 <p>）—— 同样从未经门面验证。
//   3. readBodyCapped + TextDecoder 流式重组：fixture 字节在「多字节 UTF-8 字符中间」切成两块，
//      证 CJK 正文跨 chunk 边界仍正确重组（既有流式测试只用单字节 'x' 填充，证不到这点）。
//
// SSRF 覆盖边界（按计划可行性审稿 P0，明示不越界）：
//   ✅ enforcePathPrefix 跑在 safeFetch **之前** → 存活，本单元端到端测路径越权拒。
//   ✅ readBodyCapped 跑在 safeFetch **之后** → 存活，本单元端到端跑其流式读取。
//   ❌ allowlist-per-hop / 私网 IP-pinning 在 safeFetch **内部** → 被 mock 绕过，**不在本单元**，
//      仍由 ssrf-guard.test.ts / guarded-fetch.test.ts 单测 + A4a 特征化守护。
//
// 注：本 fixture 在 packages/backend/src/__fixtures__/，**不**被 scripts/check-fixture-secrets.sh
// 扫描（该闸路径硬锚在 packages/extension/tests/e2e/fixtures）。脱敏靠合成内容本身保证：
// 全部为虚构占位，无任何 token/cookie/PII。

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock safeFetch（保留真 SsrfError，enforcePathPrefix 越权拒依赖它）。
vi.mock("./scraper/ssrf-guard.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./scraper/ssrf-guard.js")>()),
	safeFetch: vi.fn(),
}));
// Mock 渠道存储：测试直接控制某 host 是否有渠道记录（path_prefix），不碰 DB。
vi.mock("./scraper/channel-store.js", () => ({
	getChannelByHostname: vi.fn(() => null),
}));

import {
	fetchContent,
	fetchListPaged,
} from "./scraper/adapters/generic-adapter.js";
import { getChannelByHostname } from "./scraper/channel-store.js";
import { safeFetch } from "./scraper/ssrf-guard.js";

const mockSafeFetch = vi.mocked(safeFetch);
const mockGetChannel = vi.mocked(getChannelByHostname);

beforeEach(() => {
	mockSafeFetch.mockReset();
	mockGetChannel.mockReset();
	mockGetChannel.mockReturnValue(null); // 默认无渠道记录（env-only host，无 path 约束）
});

function fixture(name: string): string {
	return readFileSync(
		new URL(`./__fixtures__/${name}`, import.meta.url),
		"utf8",
	);
}

type ChannelLike = ReturnType<typeof getChannelByHostname>;
function channel(pathPrefix: string): ChannelLike {
	return {
		id: "c1",
		hostname: "gossip.example.com",
		displayName: "g",
		pathPrefix,
		maxDepth: 1,
		maxBytes: 5 * 1024 * 1024,
		createdBy: "op",
		reason: "",
		createdAt: "2026-01-01T00:00:00Z",
	} as ChannelLike;
}

/** content-length 缺失的纯文本 Response（body=null → readBodyCapped 回退 text()）。 */
function makeTextResponse(body: string, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(),
		text: async () => body,
		body: null,
	} as unknown as Response;
}

/**
 * 真 ReadableStream body 的 Response，字节在「多字节 UTF-8 字符中间」切成两块。
 * 强制 readBodyCapped 的 TextDecoder 流式重组路径（`decode(chunk, {stream:true})`）。
 */
function makeChunkedResponse(html: string): Response {
	const bytes = new TextEncoder().encode(html);
	// 取中点附近、落在「续字节」(0b10xxxxxx) 上的切点 → 保证切在某个多字节字符内部。
	let split = Math.floor(bytes.length / 2);
	while (split < bytes.length && (bytes[split] & 0xc0) !== 0x80) split++;
	const first = bytes.subarray(0, split);
	const second = bytes.subarray(split);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(first);
			controller.enqueue(second);
			controller.close();
		},
	});
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		body: stream,
		text: async () => html,
	} as unknown as Response;
}

describe("E4 真提取层 e2e：容器配平（流式 + 巢状）", () => {
	it("详情页有真正文容器 → 抓全巢状段落，og:description/nav/footer/script 噪声均不入正文", async () => {
		const html = fixture("gossip-detail-container.html");
		// anti-false-green 前置：确认 fixture 确实带噪声标记，否则 not.toContain 形同虚设。
		expect(html).toContain("导航噪声不应入正文");
		expect(html).toContain("营销用的简短摘要");

		mockSafeFetch.mockResolvedValueOnce(makeChunkedResponse(html));
		const res = await fetchContent("https://gossip.example.com/gossip/10001");

		// og:title 优先；流式分块后 CJK 标题完整。
		expect(res.title).toBe("明星A工作室深夜回应解约风波");
		// 容器配平抓全巢状 <div><p>：首段与末段均在，证未被腰斩。
		expect(res.body).toContain("工作室在凌晨发出三点声明");
		expect(res.body).toContain("第三点，明星A后续行程一切照旧");
		// 容器优先于 og:description（extractBody 优先序）：营销摘要不应成为正文。
		expect(res.body).not.toContain("营销用的简短摘要");
		// 容器外噪声零泄漏。
		expect(res.body).not.toContain("导航噪声");
		expect(res.body).not.toContain("页脚版权噪声");
		expect(res.body).not.toContain("noise-script");
		// og meta 旁路字段。
		expect(res.coverImageUrl).toBe("https://cdn.example.com/cover-a.jpg");
		expect(res.metadata?.publishedTime).toBe("2026-06-21T08:30:00+08:00");
	});
});

describe("E4 真提取层 e2e：密度兜底（无容器 class、无 og:description）", () => {
	it("详情页无正文容器 → 聚合 <p> 段落，nav/footer 内的段落被剥离", async () => {
		const html = fixture("gossip-detail-density.html");
		expect(html).toContain("导航区的段落噪声");

		mockSafeFetch.mockResolvedValueOnce(makeChunkedResponse(html));
		const res = await fetchContent("https://gossip.example.com/gossip/20001");

		expect(res.title).toBe("艺人B新瓜：机场同框疑云");
		// 密度兜底聚合正文 <p>。
		expect(res.body).toContain("被拍到与神秘人同框现身机场");
		expect(res.body).toContain("双方经纪公司均未对此事作出正式回应");
		// nav/footer 内的 <p> 噪声被剥离（extractByDensity 先剥 nav/footer 再聚合）。
		expect(res.body).not.toContain("导航区的段落噪声");
		expect(res.body).not.toContain("页脚区的段落噪声");
	});
});

describe("E4 真提取层 e2e：擬真列表翻页发现", () => {
	it("page1(rel=next→page2) → 跨页发现详情 URL、跨页去重、过滤非详情/外站", async () => {
		mockSafeFetch
			.mockResolvedValueOnce(
				makeTextResponse(fixture("gossip-list-page1.html")),
			)
			.mockResolvedValueOnce(
				makeTextResponse(fixture("gossip-list-page2.html")),
			);

		const results = await fetchListPaged("https://gossip.example.com/list", 5);
		const urls = results.map((r) => r.url);

		expect(urls).toContain("https://gossip.example.com/gossip/10001");
		expect(urls).toContain("https://gossip.example.com/gossip/10002.html");
		expect(urls).toContain("https://gossip.example.com/gossip/10003");
		// 非详情 /about 与外站 other.com 被过滤。
		expect(urls).not.toContain("https://gossip.example.com/about");
		expect(urls.some((u) => u.includes("other.com"))).toBe(false);
		// page1/page2 重复的 10002.html 跨页去重，只出现一次。
		expect(urls.filter((u) => u.endsWith("/gossip/10002.html"))).toHaveLength(
			1,
		);
		// 两页各一次请求。
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
	});
});

describe("E4 SSRF 边界（端到端可测的那半）：enforcePathPrefix 在 fetch 前拒越权", () => {
	it("渠道 path_prefix=/gossip/ + 详情 URL 越权 → SsrfError，不发起 safeFetch", async () => {
		mockGetChannel.mockReturnValue(channel("/gossip/"));
		await expect(
			fetchContent("https://gossip.example.com/admin/secret"),
		).rejects.toThrow(/不在渠道.*允许的前缀/);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});
});

// Anti-false-green（人工验证步骤，不留在仓库）：把 gossip-detail-container.html 的
// `<article class="article-content">` 改成无关键词的 `<article class="x">`，则容器提取失败、
// 正文落 og:description 兜底 → 「工作室在凌晨发出三点声明」断言变红、且「营销用的简短摘要」
// 断言变红，证容器提取路径真在生效（而非碰巧 og 兜底也含同字）。验证后还原 fixture。
