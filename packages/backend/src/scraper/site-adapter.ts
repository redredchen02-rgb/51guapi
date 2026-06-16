// 通用 SiteAdapter 接口：适配不同目标站点的内容抓取。
import type { FactsBlock } from "@51guapi/shared";

/** 从目标站点抓取的原始内容。 */
export interface RawContent {
	title: string;
	body: string;
	url: string;
	metadata?: Record<string, string>;
	/** 封面图 URL（DOM 直接提取，非 LLM 推断）。 */
	coverImageUrl?: string;
}

/** 站点适配器接口——每个目标站点实现一个。 */
export interface SiteAdapter {
	readonly name: string;
	fetchContent(url: string): Promise<RawContent>;
	/** 从列表页发现详情页 URL。可选；缺失时调度器回退到单条 URL 模式。*/
	fetchList?(listUrl: string): Promise<string[]>;
}

/** 站点配置。 */
export interface ScraperSiteConfig {
	siteName: string;
	adapterName: string;
	url: string;
	/** 列表页 URL；设置后启用 list-discovery 模式（fetchList）。 */
	listUrl?: string;
	cron?: string;
	enabled: boolean;
}

/** 事实提取结果。 */
export interface ExtractedFacts {
	facts: FactsBlock;
	confidence: number;
	/** 透传自 RawContent.coverImageUrl；不影响 confidence 计算。 */
	coverImageUrl?: string;
	/** 'strict' = json_schema structured output; 'fallback' = json_object 模式(confidence 上限 0.3)。 */
	extractionMode: "strict" | "fallback";
}
