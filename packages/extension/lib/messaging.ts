import type { GenerateDraftResponse } from "@51guapi/shared";
import { applyPromptTemplate, type FactsBlock } from "@51guapi/shared";
import { browser } from "#imports";
import type { Batch } from "./batch";
import type { RuntimeMessage } from "./messages";
import { ADMIN_PAGE_HOST } from "./recipe";

// MV3 Service Worker 随时可能被回收。sendMessage 若 SW 死亡可能永久 pending。
// sendMsg 包一层 race，超时则 reject → withBusy catch 显示"请重试"而非卡死。
const SW_TIMEOUT: Partial<Record<RuntimeMessage["type"], number>> = {
	RUN_BATCH: 300_000, // 多条 × LLM，最多 5 分钟
	GENERATE_DRAFT: 30_000,
	GET_BATCH: 10_000,
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
): Promise<GenerateDraftResponse> {
	return sendMsg<GenerateDraftResponse>({ type: "GENERATE_DRAFT", prompt });
}

/**
 * 纯函数:从 tab 列表挑出后台页 tab id。
 * 优先当前活动 tab(若它就是后台页);否则取任一 host 匹配的后台页 tab。
 */
export function pickAdminTabId(
	activeTab: { id?: number; url?: string } | undefined,
	hostMatchedTabs: ReadonlyArray<{ id?: number }>,
	host: string,
): number | null {
	if (activeTab?.id != null && activeTab.url?.includes(host))
		return activeTab.id;
	const withId = hostMatchedTabs.find((t) => typeof t.id === "number");
	return withId?.id ?? null;
}

/** 解析后台页所在 tab id(优先活动 tab,否则按 host 在所有窗口里找)。 */
export async function resolveAdminTabId(): Promise<number | null> {
	const host = ADMIN_PAGE_HOST;
	const [active] = await browser.tabs.query({
		active: true,
		currentWindow: true,
	});
	const matched = await browser.tabs.query({ url: `https://${host}/*` });
	return pickAdminTabId(active, matched, host);
}

// ---- 批量生成(side panel → background)----

export type BatchResponse = Batch | null;

/** 启动批量:逐条生成草稿并存盘(只生成,不填充/不发布)。 */
export async function runBatch(
	topics: string[],
	tabId: number,
	facts?: FactsBlock[],
	coverImageUrls?: string[],
	iterate?: boolean,
	topicIds?: string[],
	enrichments?: (string | undefined)[],
): Promise<BatchResponse> {
	return sendMsg<BatchResponse>({
		type: "RUN_BATCH",
		topics,
		tabId,
		facts,
		iterate,
		coverImageUrls,
		topicIds,
		enrichments,
	});
}

/** 读当前批次(加载即崩溃恢复)。 */
export async function getBatchState(): Promise<BatchResponse> {
	return sendMsg<BatchResponse>({ type: "GET_BATCH" });
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
