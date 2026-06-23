import type { GenerateDraftResponse } from "@51guapi/shared";
import { applyPromptTemplate, type FactsBlock } from "@51guapi/shared";
import { browser } from "#imports";
import type { GenerateArticleResponse } from "./llm";
import type { GenerateDraftOptions, RuntimeMessage } from "./messages";

// MV3 Service Worker 随时可能被回收。sendMessage 若 SW 死亡可能永久 pending。
// sendMsg 包一层 race，超时则 reject → withBusy catch 显示"请重试"而非卡死。
const SW_TIMEOUT: Partial<Record<RuntimeMessage["type"], number>> = {
	// A11/R10:SW 看门狗须 ≥ 请求超时(llm.ts generate 默认 60s),否则 SW 先于请求超时报
	// "请重试",而后端 LLM 请求仍在跑 → 用户重试 = 重复调用 LLM 重复扣费。65s 留 5s 缓冲。
	GENERATE_DRAFT: 65_000,
	GENERATE_ARTICLE: 65_000,
};

function sendMsg<T>(msg: RuntimeMessage): Promise<T> {
	const ms = SW_TIMEOUT[msg.type] ?? 30_000;
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() =>
				reject(
					new Error(
						`[sw/${msg.type}] 未在 ${ms / 1000}s 内响应，SW 可能已回收，请重试`,
					),
				),
			ms,
		);
		(browser.runtime.sendMessage(msg) as Promise<T>).then(
			(result) => {
				clearTimeout(timer);
				resolve(result);
			},
			(err: unknown) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

/** side panel → background:生成草稿。 */
export async function requestGenerate(
	prompt: string,
	options?: GenerateDraftOptions,
): Promise<GenerateDraftResponse> {
	return sendMsg<GenerateDraftResponse>({
		type: "GENERATE_DRAFT",
		prompt,
		options,
	});
}

/** side panel → background:为已审 gossip 选题生成九段落文章草稿。 */
export async function requestGenerateArticle(
	topicId: string,
): Promise<GenerateArticleResponse> {
	return sendMsg<GenerateArticleResponse>({
		type: "GENERATE_ARTICLE",
		topicId,
	});
}

/**
 * 用 prompt 模板 + 主题 + (可选)事实 + (可选)few-shot 组装最终 prompt。
 * 委托 lib/facts 的纯函数;facts/fewShot 省略时行为等同旧两参版(向后兼容)。
 */
export function buildPrompt(
	template: string,
	topic: string,
	facts?: FactsBlock,
	fewShot?: string,
): string {
	return applyPromptTemplate(template, topic, facts, fewShot);
}
