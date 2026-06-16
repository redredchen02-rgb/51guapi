/**
 * template-adapter.ts — 新站点适配器开发脚手架。
 *
 * 使用方法：
 *   1. 复制此文件，重命名为 <site>-adapter.ts（如 mysite-adapter.ts）
 *   2. 修改下面标记 [CUSTOMIZE] 的地方为目标站点的真实选择器/逻辑
 *   3. 在 scraper-config.ts 中注册：scraperConfig.registerAdapter(new TemplateSiteAdapter())
 *   4. 重启后端；待审选题将出现在 PendingTopicsView
 *
 * 接口要求：
 *   - name：适配器唯一名称（与 ScraperSiteConfig.adapterName 对应）
 *   - fetchContent(url)：返回 RawContent（title + body + url + 可选 coverImageUrl）
 *
 * @example
 * ```ts
 * export class MySiteAdapter implements SiteAdapter {
 *   readonly name = "my-site";
 *   async fetchContent(url: string): Promise<RawContent> {
 *     const html = await fetch(url).then(r => r.text());
 *     return {
 *       title: extractTitle(html),
 *       body: extractBody(html),
 *       url,
 *     };
 *   }
 * }
 * ```
 */

import type { RawContent, SiteAdapter } from "../site-adapter.js";
import { safeFetch } from "../ssrf-guard.js";

// ---- HTML 解析辅助 ----
// 简单正则足够应对无 DOM 环境的服务端；如目标站点有复杂 DOM 需求可引入 cheerio。

function _extractBySelector(
	html: string,
	selector: string,
): string | undefined {
	// [CUSTOMIZE] 替换为适合目标站点的提取逻辑
	const ogTitleMatch = html.match(
		/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
	);
	if (ogTitleMatch) return ogTitleMatch[1].trim();
	void selector;
	return undefined;
}

function extractTitle(html: string): string {
	// [CUSTOMIZE] 替换为目标站点的标题选择器
	// 优先 og:title，回落 <title>
	const ogTitle = html.match(
		/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
	)?.[1];
	if (ogTitle) return ogTitle.trim();

	const pageTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
	return pageTitle ? pageTitle.trim() : "Untitled";
}

function extractBody(html: string): string {
	// [CUSTOMIZE] 替换为目标站点正文容器选择器
	// 示例：提取 <article> 或 <div class="content"> 内的文本
	// 这里演示最简单的全页剥标签方案——真实适配器应只取正文区域
	const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, "");
	const noStyle = noScript.replace(/<style[\s\S]*?<\/style>/gi, "");
	const noTags = noStyle.replace(/<[^>]*>/g, " ");
	return noTags.replace(/\s+/g, " ").trim().slice(0, 10_000);
}

function extractCoverImageUrl(html: string): string | undefined {
	// [CUSTOMIZE] 替换为目标站点封面图选择器
	// 常见方案 1：og:image meta 标签
	const ogImage = html.match(
		/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
	)?.[1];
	if (ogImage) return ogImage.trim();

	// 常见方案 2：文章首图 <img src="...">
	// const firstImg = html.match(/<article[\s\S]*?<img[^>]+src=["']([^"']+)["']/i)?.[1];
	// if (firstImg) return firstImg.trim();

	return undefined;
}

// ---- 适配器实现 ----

export class TemplateSiteAdapter implements SiteAdapter {
	// [CUSTOMIZE] 改为目标站点的唯一名称（英文小写，与 scraperConfig.registerAdapter 调用一致）
	readonly name = "template-site";

	async fetchContent(url: string): Promise<RawContent> {
		const res = await safeFetch(url, {
			headers: {
				// [CUSTOMIZE] 如目标站点有 UA 限制，调整此处
				"User-Agent":
					"Mozilla/5.0 (compatible; 51guapi-scraper/1.0; +http://127.0.0.1:3001)",
				// [CUSTOMIZE] 如需登录 cookie，在此添加 Cookie 头（从环境变量读取，切勿硬编码）
			},
		});

		if (!res.ok) {
			throw new Error(`HTTP ${res.status}: Failed to fetch ${url}`);
		}

		const html = await res.text();

		const title = extractTitle(html);
		const body = extractBody(html);
		const coverImageUrl = extractCoverImageUrl(html);

		if (!body) {
			throw new Error(`Empty body received from ${url}`);
		}

		return {
			title,
			body,
			url,
			// coverImageUrl 若提取到则传递；fact-extractor 会透传到 PendingTopic
			...(coverImageUrl ? { coverImageUrl } : {}),
			// metadata 可放置额外键值（如作者、发布日期），目前 fact-extractor 不使用
			metadata: {
				// [CUSTOMIZE] 按需填入
				// publishedAt: extractBySelector(html, 'time[datetime]') ?? '',
			},
		};
	}
}

// [CUSTOMIZE] 在 packages/backend/src/scraper/scraper-config.ts 里取消下面这行的注释：
// scraperConfig.registerAdapter(new TemplateSiteAdapter());
