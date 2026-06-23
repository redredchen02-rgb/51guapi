import type {
	FactsBlock,
	GenerateDraftResponse,
	GossipFactsBlock,
} from "@51guapi/shared";
import type { GenerateArticleResponse } from "../lib/llm";
import { generateArticle, generateDraft } from "../lib/llm";
import { logger } from "../lib/logger";
import type { GenerateDraftOptions, RuntimeMessage } from "../lib/messages";
import { buildConstraintSuffix } from "../lib/prompt-assembly";
import { getSettings } from "../lib/storage";

// Background service worker:生成调度中心。
// - 点扩展图标打开 side panel
// - 路由 GENERATE_DRAFT → 生成吃瓜草稿
// - 路由 GENERATE_ARTICLE → 生成规范七/八 九段落文章

export interface BackgroundHandlerDeps {
	getSettings: () => Promise<import("@51guapi/shared").Settings>;
	generateDraftFn: (
		prompt: string,
		opts: {
			settings: import("@51guapi/shared").Settings;
			facts?: FactsBlock | GossipFactsBlock;
		},
	) => Promise<GenerateDraftResponse>;
	generateArticleFn: (topicId: string) => Promise<GenerateArticleResponse>;
}

export { buildConstraintSuffix };

export function createHandlers(deps: BackgroundHandlerDeps) {
	async function handleGenerate(
		prompt: string,
		options: GenerateDraftOptions = {},
	): Promise<GenerateDraftResponse> {
		try {
			const settings = await deps.getSettings();
			const constrainedPrompt =
				prompt + buildConstraintSuffix(settings.recommendedTags ?? []);
			return await deps.generateDraftFn(constrainedPrompt, {
				settings,
				facts: options.facts,
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

	async function handleGenerateArticle(
		topicId: string,
	): Promise<GenerateArticleResponse> {
		try {
			return await deps.generateArticleFn(topicId);
		} catch (err) {
			logger.error("bg", "生成文章失败", {
				err: err instanceof Error ? err.message : String(err),
			});
			return {
				ok: false,
				kind: "network",
				error: "生成文章时发生内部错误，请重试。",
			};
		}
	}

	return { handleGenerate, handleGenerateArticle };
}

export default defineBackground(() => {
	browser.sidePanel
		?.setPanelBehavior({ openPanelOnActionClick: true })
		.catch((err: unknown) =>
			logger.error("bg", "setPanelBehavior 失败", {
				err: err instanceof Error ? err.message : String(err),
			}),
		);

	// SW Keep-Alive:定时唤醒,防止长时间生成时背景因闲置被杀。
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

	const liveDeps: BackgroundHandlerDeps = {
		getSettings,
		generateDraftFn: generateDraft,
		generateArticleFn: generateArticle,
	};

	const handlers = createHandlers(liveDeps);

	browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
		if (message?.type === "GENERATE_DRAFT")
			return handlers.handleGenerate(message.prompt, message.options);
		if (message?.type === "GENERATE_ARTICLE")
			return handlers.handleGenerateArticle(message.topicId);
		return undefined;
	});
});
