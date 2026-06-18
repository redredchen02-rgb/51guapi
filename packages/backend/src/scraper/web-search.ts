// Web 搜索层：用 Jina (r.jina.ai) 抓取 pixiv 作者/作品页面补充资讯。
//
// 安全不变量（security-lens，钉死）：
//   - `JINA_PREFIX` 是**硬编码出口**（固定第三方 host），本就在 channel SSRF allowlist 之外。
//   - query 永远是 `encodeURIComponent` 后的**路径段**，绝不当 URL 拼接、绝不来自渠道配置。
//   - 此路径**有意不走 allowlist**，且**必须保持 fixed-prefix**——出口 host 不被 query 污染。
//   修改 `JINA_PREFIX` 或让出口可配置 = 引入 SSRF 原语，禁止。

import type { FactsBlock } from "@51guapi/shared";

export interface SearchResult {
	title: string;
	snippet: string;
	url: string;
}

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const JINA_PREFIX = "https://r.jina.ai/";

/** 从 Jina 返回的 Markdown 中提取有用信息。 */
export function parseJinaContent(
	content: string,
	sourceUrl: string,
): SearchResult[] {
	const results: SearchResult[] = [];

	// 提取标题
	const titleMatch = content.match(/^Title:\s*(.+)$/m);
	const title = titleMatch ? titleMatch[1].trim() : "";

	// 提取页面描述或前几段作为摘要
	const lines = content.split("\n").filter((l) => l.trim());
	const snippetLines: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		// 跳过导航、图片链接等
		if (
			trimmed.startsWith("[![") ||
			trimmed.startsWith("* [") ||
			trimmed.startsWith("- [") ||
			trimmed.includes("pixiv.net/en/") ||
			trimmed.includes("pximg.net") ||
			trimmed.length < 10
		) {
			continue;
		}
		// 收集有意义的文本行
		if (snippetLines.length < 3 && !trimmed.startsWith("#")) {
			snippetLines.push(trimmed);
		}
	}

	const snippet = snippetLines.join(" ").slice(0, 300);

	if (title || snippet) {
		results.push({
			title: title || "pixiv 作者页面",
			snippet,
			url: sourceUrl,
		});
	}

	return results;
}

/** 用 Jina 抓取 pixiv 作者标签页面。 */
export async function fetchPixivByArtist(
	artistName: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 15_000,
): Promise<SearchResult[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const url = `${JINA_PREFIX}pixiv.net/tags/${encodeURIComponent(artistName)}`;
		const res = await fetchFn(url, {
			headers: {
				"User-Agent": UA,
				Accept: "text/plain",
			},
			signal: controller.signal,
		});

		if (!res.ok) return [];

		const content = await res.text();
		return parseJinaContent(
			content,
			`https://pixiv.net/tags/${encodeURIComponent(artistName)}`,
		);
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

/** 用 Jina 抓取 pixiv 搜索页面（作品名）。 */
export async function fetchPixivByWork(
	workName: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 15_000,
): Promise<SearchResult[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		// 去掉特殊字符，保留可搜索部分
		const cleanName = workName
			.replace(/[～〜~]/g, " ")
			.replace(/[（(][^）)]*[）)]/g, "")
			.replace(/\s+/g, " ")
			.trim();

		if (!cleanName) return [];

		const url = `${JINA_PREFIX}pixiv.net/tags/${encodeURIComponent(cleanName)}`;
		const res = await fetchFn(url, {
			headers: {
				"User-Agent": UA,
				Accept: "text/plain",
			},
			signal: controller.signal,
		});

		if (!res.ok) return [];

		const content = await res.text();
		return parseJinaContent(
			content,
			`https://pixiv.net/tags/${encodeURIComponent(cleanName)}`,
		);
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

/** 根据事实构建搜索任务列表。 */
export function buildSearchTasks(
	facts: FactsBlock,
	maxQueries: number,
): Array<{ type: "artist" | "work"; query: string }> {
	const tasks: Array<{ type: "artist" | "work"; query: string }> = [];

	const maker = facts.制作?.trim();
	const name = facts.作品名?.trim();

	// 优先用作者名搜 pixiv（同人作者的主要平台）
	if (maker) {
		const coreMaker = maker.replace(/[（(][^）)]*[）)]/g, "").trim() || maker;
		tasks.push({ type: "artist", query: coreMaker });
	}

	// 用作品名搜 pixiv
	if (name && tasks.length < maxQueries) {
		tasks.push({ type: "work", query: name });
	}

	return tasks.slice(0, maxQueries);
}

/** 执行单个搜索任务。 */
export async function executeSearchTask(
	task: { type: "artist" | "work"; query: string },
	fetchFn: typeof fetch,
	timeoutMs: number,
): Promise<{ query: string; results: SearchResult[] }> {
	let results: SearchResult[];
	if (task.type === "artist") {
		results = await fetchPixivByArtist(task.query, fetchFn, timeoutMs);
	} else {
		results = await fetchPixivByWork(task.query, fetchFn, timeoutMs);
	}
	return { query: task.query, results };
}

// 安全测试用：暴露固定出口前缀供 startsWith 断言（值不可变）。
export { JINA_PREFIX, UA };
