import type { ContentDraft, FewShotPair, Settings } from "@51guapi/shared";
import { storage } from "#imports";
import { clearBackendUrlCache } from "./backend-url";
import type { Batch } from "./batch";
import { recoverBatch } from "./batch";

const SETTINGS_KEY = "local:settings";
const API_KEY = "local:apiKey";
const BACKEND_TOKEN_KEY = "local:backendToken";
const CURRENT_DRAFT_KEY = "local:currentDraft";
const BATCH_KEY = "local:batch";
const EXTENSION_COUNTERS_KEY = "local:extensionCounters";

/** 默认设置(API key 单独存取,不在此对象内)。 */
export const DEFAULT_SETTINGS: Settings = {
	endpoint: "",
	model: "gpt-4o-mini",
	fallbackModel: "",
	// 程序化结构化生成(防幻觉):模型只写口吻散文「槽位」,作品名/集数/制作/连结/分类由系统注入。
	// 占位符:{{fewshot}} few-shot 范例 / {{topic}} 选题 / {{facts}} 结构化事实块。
	promptTemplate: [
		"{{fewshot}}你是「51娘」,成人動畫/裏番與成人同人漫畫介紹站的看板娘,口吻活潑,以「嗨嗨~大家好我是51娘」開場、結尾招呼各位紳士。",
		"",
		"你的任务:只写「口吻散文」,不要拼装整篇正文。作品名、集数、制作、连结、抬头、分类标签由系统填入,你绝不要自己写它们。",
		"",
		"铁律:",
		"1. 只根据【事实】写;严禁编造或陈述任何【事实】未给出的具体信息(年份、声优、剧情细节等),缺的信息直接不提。",
		"2. 散文里绝不写任何 URL/连结,也不要写「漢化連結」「無修連結」这类条目——这些由系统注入。",
		"3. 不要罗列「作品名=…」「集数=…」这类字段,那由系统的抬头块负责;你只写引子与看点的口语化介绍。",
		"",
		"以 JSON 返回这些字段(全部纯文本,不含 HTML):",
		"- intro:开场引子(51娘 口吻,1–3 句)",
		"- highlights:看点介绍(2–4 句,只用【事实】范围内的卖点)",
		"- titleSuffix:标题后缀(如「成人動畫介紹」「成人同人推薦」;系统会前置作品名)",
		"- subtitle:一句俏皮副标题",
		"- outro:结尾招呼(可选)",
		"- category:分类(从后台已知分类里挑;不确定就留空)",
		"- tags:标签数组(题材相关;不确定就给空数组)",
		"",
		"主题:{{topic}}",
		"",
		"{{facts}}",
	].join("\n"),
	fewShotPairs: [] as FewShotPair[],
	recommendedTags: [] as string[],
	dailyBatchSize: 5,
};

/** dailyBatchSize 合法范围 [1, 20];undefined → 默认 5。 */
function clampDailyBatchSize(v: number | undefined): number {
	if (v === undefined) return 5;
	return Math.max(1, Math.min(20, Math.round(v)));
}

/** 读取设置,缺失项回落默认值(storage 为空时返回完整默认对象)。 */
export async function getSettings(): Promise<Settings> {
	const stored = await storage.getItem<Partial<Settings>>(SETTINGS_KEY);
	if (!stored) return structuredClone(DEFAULT_SETTINGS);
	const merged: Settings = {
		...DEFAULT_SETTINGS,
		...stored,
	};
	merged.dailyBatchSize = clampDailyBatchSize(merged.dailyBatchSize);
	return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
	const toSave: Settings = {
		...settings,
		dailyBatchSize: clampDailyBatchSize(settings.dailyBatchSize),
	};
	await storage.setItem(SETTINGS_KEY, toSave);
	// 清除后端 URL 缓存，确保下次请求使用新地址
	clearBackendUrlCache();
}

/** API key 单独存取(明文存于 chrome.storage.local,设置页须提示风险)。 */
export async function getApiKey(): Promise<string> {
	return (await storage.getItem<string>(API_KEY)) ?? "";
}

export async function saveApiKey(key: string): Promise<void> {
	await storage.setItem(API_KEY, key);
}

/** 后端 JWT token（与 apiKey 分开存取）。 */
export async function getBackendToken(): Promise<string> {
	return (await storage.getItem<string>(BACKEND_TOKEN_KEY)) ?? "";
}

export async function saveBackendToken(token: string): Promise<void> {
	await storage.setItem(BACKEND_TOKEN_KEY, token);
}

// 当前在编草稿的崩溃恢复(≠ 草稿库):side panel 重开/SW 回收都可能丢失,
// 故每次草稿变更写一份;"下一条"或导出完成时清除。
export async function getCurrentDraft(): Promise<ContentDraft | null> {
	return (await storage.getItem<ContentDraft>(CURRENT_DRAFT_KEY)) ?? null;
}

export async function saveCurrentDraft(draft: ContentDraft): Promise<void> {
	await storage.setItem(CURRENT_DRAFT_KEY, draft);
}

export async function clearCurrentDraft(): Promise<void> {
	await storage.removeItem(CURRENT_DRAFT_KEY);
}

// ---- 批量队列持久化 + 崩溃恢复 ----
// MV3 SW 随时被回收;每次状态推进都写盘。加载时跑 recoverBatch:
// 卡在 generating 的条目 → error,可重试。

/** 读批次。读到即应用崩溃恢复。无批次 → null。 */
export async function getBatch(): Promise<Batch | null> {
	const stored = await storage.getItem<Batch>(BATCH_KEY);
	if (!stored || !Array.isArray(stored.items)) return null;
	return recoverBatch(stored);
}

export async function saveBatch(batch: Batch): Promise<void> {
	await storage.setItem(BATCH_KEY, batch);
}

export async function clearBatch(): Promise<void> {
	await storage.removeItem(BATCH_KEY);
}

// ---- 扩展端运营计数器（跨会话持久，chrome.storage.local）----
// batchesCompleted 由 background.ts handleRunBatch 成功完成时递增；
// publishAttempts 为 future placeholder（发布机器已拆除，当前不接线）。

export interface ExtensionCounters {
	publishAttempts: { success: number; failed: number };
	batchesCompleted: number;
}

function defaultExtensionCounters(): ExtensionCounters {
	return { publishAttempts: { success: 0, failed: 0 }, batchesCompleted: 0 };
}

/**
 * 读取扩展端计数器。读不到或字段不完整时回落完整默认对象（不崩溃）。
 */
export async function getExtensionCounters(): Promise<ExtensionCounters> {
	const stored = await storage.getItem<Partial<ExtensionCounters>>(
		EXTENSION_COUNTERS_KEY,
	);
	const def = defaultExtensionCounters();
	if (!stored) return def;
	return {
		publishAttempts: {
			success: stored.publishAttempts?.success ?? def.publishAttempts.success,
			failed: stored.publishAttempts?.failed ?? def.publishAttempts.failed,
		},
		batchesCompleted: stored.batchesCompleted ?? def.batchesCompleted,
	};
}

export async function saveExtensionCounters(
	c: ExtensionCounters,
): Promise<void> {
	await storage.setItem(EXTENSION_COUNTERS_KEY, c);
}

// ---- Few-shot 范例（R11 一键存为范例）----

/**
 * 把结构化 fewShotPairs 序列化为 prompt 用的可读文本(单向)。
 *
 * 唯一真实来源是 `fewShotPairs`(结构化数组,持久化直接存对象),本函数仅供
 * prompt-assembly 拼 LLM 提示词。**不可逆**:若 input/output 内含 `\n---\n` 或空行,
 * 文本边界会与内容碰撞 —— 因此**不要**把本函数输出回存再 parse(历史上的文本往返已移除,
 * 避免静默数据损坏)。旧 `fewShotExamples` 字符串字段的一次性迁移由后端
 * prompt-store.ts 的 migratePairs 处理(best-effort,仅在 fewShotPairs 为空时触发)。
 */
export function deriveFewShotExamples(pairs: FewShotPair[]): string {
	return pairs.map((p) => `${p.input}\n---\n${p.output}`).join("\n\n");
}

const MAX_FEW_SHOT = 8;

/**
 * 追加一条 few-shot 范例到末尾（只写 fewShotPairs）。
 * 返回 { ok: false, reason: 'full' } 当已达上限，不写入。
 */
export async function addFewShotPair(
	pair: FewShotPair,
): Promise<{ ok: boolean; reason?: "full" }> {
	const settings = await getSettings();
	const current = settings.fewShotPairs ?? [];
	if (current.length >= MAX_FEW_SHOT) return { ok: false, reason: "full" };
	const next = [...current, pair];
	await saveSettings({ ...settings, fewShotPairs: next });
	return { ok: true };
}

/**
 * 移除末尾一条 few-shot 范例（LIFO 撤销；不影响其他条目）。
 * 空列表时幂等跳过。
 */
export async function removeLastFewShotPair(): Promise<void> {
	const settings = await getSettings();
	const current = settings.fewShotPairs ?? [];
	if (current.length === 0) return;
	const next = current.slice(0, -1);
	await saveSettings({ ...settings, fewShotPairs: next });
}
