import type {
	FactsBlock,
	GenerateDraftResponse,
	GossipFactsBlock,
} from "@51guapi/shared";
import {
	type Batch,
	type BatchItem,
	createBatch,
	markFilled,
	markGenerateFailed,
	markGenerating,
} from "../lib/batch";
import { generateDraft } from "../lib/llm";
import { logger } from "../lib/logger";
import type { GenerateDraftOptions, RuntimeMessage } from "../lib/messages";
import { assemblePrompt, buildConstraintSuffix } from "../lib/prompt-assembly";
import {
	getApiKey,
	getBatch,
	getBatch as getBatchRaw,
	getExtensionCounters,
	getSettings,
	saveBatch,
	saveExtensionCounters,
} from "../lib/storage";

// Background service worker:生成调度中心(U1:发布/填充机器已拆除)。
// - 点扩展图标打开 side panel
// - 路由 GENERATE_DRAFT → 调大模型(鉴权 + CORS 集中在此;key 绝不进 content)
// - 路由 RUN_BATCH → 逐条生成草稿并存盘(只生成,不填充/不发布)
// - 路由 GET_BATCH → 只读当前批次

export interface BackgroundHandlerDeps {
	getBatch: () => Promise<Batch | null>;
	saveBatch: (batch: Batch) => Promise<void>;
	getSettings: () => Promise<import("@51guapi/shared").Settings>;
	getApiKey: () => Promise<string>;
	generateDraftFn: (
		prompt: string,
		opts: {
			settings: import("@51guapi/shared").Settings;
			apiKey: string;
			facts?: FactsBlock | GossipFactsBlock;
			enrichment?: string;
		},
	) => Promise<GenerateDraftResponse>;
	buildBatchId: () => string;
	buildItemId: (batchId: string, i: number) => string;
	now: () => string;
}

// buildConstraintSuffix / assemblePrompt 抽在 lib/prompt-assembly.ts。
// re-export 保留既有导出面。
export { buildConstraintSuffix };

export function createHandlers(deps: BackgroundHandlerDeps) {
	async function handleGenerate(
		prompt: string,
		options: GenerateDraftOptions = {},
	): Promise<GenerateDraftResponse> {
		try {
			const [settings, apiKey] = await Promise.all([
				deps.getSettings(),
				deps.getApiKey(),
			]);
			const constrainedPrompt =
				prompt + buildConstraintSuffix(settings.recommendedTags ?? []);
			return await deps.generateDraftFn(constrainedPrompt, {
				settings,
				apiKey,
				facts: options.facts,
				enrichment: options.enrichment,
			});
		} catch (err) {
			logger.error("bg", "生成草稿失败", {
				err: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				kind: "network",
				error: "生成草稿时发生内部错误,请重试。",
			};
		}
	}

	/**
	 * 批量生成(只生成,不填充/不发布):逐条调 LLM 生成草稿并存盘。
	 * 草稿落在 batch.items[].draft,侧栏读取后用于预览 / 导出。
	 */
	async function handleRunBatch(
		topics: string[],
		tabId: number,
		facts?: FactsBlock[],
		_iterate?: boolean,
		coverImageUrls?: string[],
		topicIds?: string[],
		enrichments?: (string | undefined)[],
	): Promise<Batch | null> {
		try {
			const [settings, apiKey] = await Promise.all([
				deps.getSettings(),
				deps.getApiKey(),
			]);
			const batchId = deps.buildBatchId();
			let batch = createBatch(
				batchId,
				tabId,
				topics,
				deps.now(),
				(i) => deps.buildItemId(batchId, i),
				facts,
				coverImageUrls,
				topicIds,
				enrichments,
			);
			await deps.saveBatch(batch);

			for (const item of batch.items) {
				batch = markGenerating(batch, item.id);
				await deps.saveBatch(batch);
				const started = Date.now();
				try {
					const prompt = assemblePrompt(settings, item.topic, item.facts);
					const res = await deps.generateDraftFn(prompt, {
						settings,
						apiKey,
						facts: item.facts,
						enrichment: item.enrichment,
					});
					if (res.ok) {
						batch = markFilled(
							batch,
							item.id,
							res.draft,
							res.llmCostTokens,
							Date.now() - started,
						);
					} else {
						batch = markGenerateFailed(batch, item.id, res.error);
					}
				} catch (err) {
					batch = markGenerateFailed(
						batch,
						item.id,
						err instanceof Error ? err.message : String(err),
					);
				}
				await deps.saveBatch(batch);
			}
			const ec = await getExtensionCounters();
			ec.batchesCompleted++;
			await saveExtensionCounters(ec);
			return batch;
		} catch (err) {
			logger.error("bg", "批量生成失败", {
				err: err instanceof Error ? err.message : String(err),
			});
			return deps.getBatch();
		}
	}

	return {
		handleGenerate,
		handleRunBatch,
	};
}

/**
 * SW 启动恢复:将上次 SW 被杀时卡在 generating 状态的条目标记为 error,让操作者可以重试。
 * 失败时只 warn,绝不阻断 SW 启动。
 */
export async function runStartupGeneratingRecovery(
	deps: {
		getBatch: () => Promise<Batch | null>;
		saveBatch: (b: Batch) => Promise<void>;
	} = { getBatch: getBatchRaw, saveBatch },
): Promise<void> {
	try {
		const batch = await deps.getBatch();
		if (!batch) return;
		let changed = false;
		const items: BatchItem[] = batch.items.map((item) => {
			if (item.status === "generating") {
				changed = true;
				return {
					...item,
					status: "error" as const,
					error: "SW restarted during generation",
				};
			}
			return item;
		});
		if (changed) await deps.saveBatch({ ...batch, items });
	} catch (e) {
		logger.warn("bg", "generating recovery scan 失败", {
			err: e instanceof Error ? e.message : String(e),
		});
	}
}

export default defineBackground(() => {
	browser.sidePanel
		?.setPanelBehavior({ openPanelOnActionClick: true })
		.catch((err: unknown) =>
			logger.error("bg", "setPanelBehavior 失败", {
				err: err instanceof Error ? err.message : String(err),
			}),
		);

	// SW 启动恢复:将上次 SW 被杀时卡在 generating 状态的条目标记为 error。
	void runStartupGeneratingRecovery();

	// SW Keep-Alive:定时唤醒,防止超大批次时背景因闲置被杀。
	if (browser.alarms) {
		browser.alarms.create("keep-alive", { periodInMinutes: 1 });
		browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
			if (alarm.name === "keep-alive") {
				logger.debug("bg", "keep-alive ping");
			}
		});
	} else {
		logger.warn("bg", "chrome.alarms 不可用(缺 alarms 权限?),跳过 keep-alive");
	}

	let batchSeq = 0;

	const liveDeps: BackgroundHandlerDeps = {
		getBatch,
		saveBatch,
		getSettings,
		getApiKey,
		generateDraftFn: generateDraft,
		buildBatchId: () => {
			batchSeq += 1;
			return `batch_${Date.now()}_${batchSeq}`;
		},
		buildItemId: (batchId: string, i: number) => `${batchId}:${i}`,
		now: () => new Date().toISOString(),
	};

	const handlers = createHandlers(liveDeps);

	browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
		if (message?.type === "GENERATE_DRAFT")
			return handlers.handleGenerate(message.prompt, message.options);
		if (message?.type === "RUN_BATCH")
			return handlers.handleRunBatch(
				message.topics,
				message.tabId,
				message.facts,
				message.iterate,
				message.coverImageUrls,
				message.topicIds,
				message.enrichments,
			);
		if (message?.type === "GET_BATCH") return getBatch();
		return undefined;
	});
});
