import { browser } from "#imports";
import type { Batch } from "./batch";
import type { DriftReport } from "./selectors";
import type {
	ContentDraft,
	FillPageResponse,
	GenerateDraftResponse,
	PublishPageResponse,
} from "./types";

/** side panel → background:生成草稿。 */
export async function requestGenerate(
	prompt: string,
): Promise<GenerateDraftResponse> {
	return browser.runtime.sendMessage({ type: "GENERATE_DRAFT", prompt });
}

/** side panel → 当前标签页 content script:填充。 */
export async function requestFill(
	draft: ContentDraft,
): Promise<FillPageResponse> {
	const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id) return { ok: false, error: "未找到当前标签页。" };
	try {
		return await browser.tabs.sendMessage(tab.id, { type: "FILL_PAGE", draft });
	} catch {
		return {
			ok: false,
			error:
				"无法连接页面填充脚本——请确认当前停在 51publisher 发帖页并已打开「添加」表单。",
		};
	}
}

/**
 * side panel → background:请求发布指定 tab。
 * 发布**改道经 background**(不再 side panel 直连 content):闸门求值 + host 取自浏览器
 * 都在 background;此处只传**显式 tabId**(绝不让 background 查 active tab)。
 */
export async function requestPublish(
	tabId: number,
): Promise<PublishPageResponse> {
	return browser.runtime.sendMessage({ type: "PUBLISH_PAGE", tabId });
}

// ---- 批量编排(side panel → background)----

export type BatchResponse = Batch | null;

/** 启动批量:逐条生成+填充到钉住的 tab,完成后进入 awaiting-approval。 */
export async function runBatch(
	topics: string[],
	tabId: number,
): Promise<BatchResponse> {
	return browser.runtime.sendMessage({ type: "RUN_BATCH", topics, tabId });
}

/** 批准整批:逐条门控发布(钉住的 tab)。 */
export async function approveBatch(tabId: number): Promise<BatchResponse> {
	return browser.runtime.sendMessage({ type: "APPROVE_BATCH", tabId });
}

/** 急停:未发布项打到 aborted。 */
export async function killBatch(): Promise<BatchResponse> {
	return browser.runtime.sendMessage({ type: "KILL_BATCH" });
}

/** 人工退出某隔离项(needs-human-verification → aborted)。 */
export async function releaseQuarantine(
	itemId: string,
): Promise<BatchResponse> {
	return browser.runtime.sendMessage({ type: "RELEASE_QUARANTINE", itemId });
}

/** 标记该条草稿已被操作者手动修改(直发率度量置位)。 */
export async function markItemEdited(itemId: string): Promise<void> {
	return browser.runtime.sendMessage({ type: "MARK_ITEM_EDITED", itemId });
}

/** 读当前批次(加载即崩溃恢复)。 */
export async function getBatchState(): Promise<BatchResponse> {
	return browser.runtime.sendMessage({ type: "GET_BATCH" });
}

/** 轻量漂移自检:让钉住 tab 的 content 查关键选择器是否缺失。 */
export async function checkSelectors(tabId: number): Promise<DriftReport> {
	try {
		return await browser.tabs.sendMessage(tabId, { type: "CHECK_SELECTORS" });
	} catch {
		return { ok: false, missing: ["(无法连接页面——请确认停在 admin 发帖页)"] };
	}
}

/** 用 prompt 模板 + 主题组装最终 prompt。 */
export function buildPrompt(template: string, topic: string): string {
	return template.includes("{{topic}}")
		? template.replaceAll("{{topic}}", topic)
		: `${template}\n主题:${topic}`;
}
