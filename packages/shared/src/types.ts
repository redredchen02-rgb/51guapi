// 三层(side panel / background / content script)共享的类型定义。
// Migrated from both packages/backend/src/shared/types.ts and packages/extension/lib/types.ts
import type { FactsBlock } from "./facts.js";
import type { VerificationResult } from "./gossip-verify.js";
import type { DraftSlots } from "./post-assembler.js";

/** Few-shot 范例对;结构化存储格式，序列化为 string 供 LLM prompt 使用。 */
export interface FewShotPair {
	input: string;
	output: string;
}

/** 草稿在本插件内的生命周期状态。 */
export type DraftStatus = "draft" | "filled" | "published";

/**
 * 一条内容草稿。AI 生成 title/subtitle/category/body/tags/description;
 * coverImageUrl 由人工在 side panel 填写或取默认值(非 AI 生成)。
 */
export interface ContentDraft {
	id: string;
	title: string;
	subtitle: string;
	/** 后台分类(对应 select[name=type] 的 value,如 "2"/"4")。 */
	category: string;
	/** 封面图 URL;自动抓取时由适配器提供。 */
	coverImageUrl: string;
	/** 正文 HTML(写入 Quill 前需消毒)。 */
	body: string;
	tags: string[];
	/** 描述/摘要(AI 生成)。 */
	description: string;
	status: DraftStatus;
	/** ISO 时间戳。 */
	createdAt: string;
	/** Web 富化上下文(可选;来自 web-enricher)。 */
	enrichment?: string;
}

/** 用户可配置的设置(API key 单独存取,不在此对象内)。 */
export interface Settings {
	/** 大模型 endpoint(OpenAI 兼容 chat/completions),须为 https。 */
	endpoint: string;
	/** 模型名。 */
	model: string;
	/** 备用模型名(主模型超时或 5xx 时自动切换重试，留空则不使用)。 */
	fallbackModel?: string;
	/** prompt 模板,用户主题会注入其中。支持占位符 {{topic}} {{facts}} {{fewshot}}。 */
	promptTemplate: string;
	/** 结构化 few-shot 范例列表;唯一编辑源,序列化由 deriveFewShotExamples() 处理。 */
	fewShotPairs?: FewShotPair[];
	/** 运营者维护的推荐标签子集(~20-50 条);注入 prompt 约束,防模型造词(R5-R6)。 */
	recommendedTags?: string[];
	/** 吃瓜小帮手 后端 URL（http://localhost:3002 等）;空=不启用后端双写。 */
	backendUrl?: string;
	/** AI 评审标准 prompt（Phase 3）;空时使用内置四维默认标准。 */
	reviewCriteriaPrompt?: string;
	/** 是否启用 Web 搜索富化（默认 true）;启用后抓取时自动搜索补充资讯。 */
	webSearchEnabled?: boolean;
}

// ---- 消息协议(side panel ↔ background ↔ content script) ----

/** 拒绝原因枚举值（路由层校验；DB 列保留 TEXT 存储字符串值）。 */
export type RejectionReason =
	| "duplicate"
	| "quality"
	| "topic_mismatch"
	| "missing_facts"
	| "other";

/**
 * 待审选题的 API / wire 契约（side panel ↔ backend 单一真相,取代扩展端原本的重复定义）。
 * 后端「存储」表示(pending-store.PendingTopic:enrichment 对象 + facts 强类型 union)是实现
 * 细节,经路由 toApiTopic 映射到此形状(enrichment→enrichmentText、route 注入 folded)。
 *
 * facts 用宽松可索引 dict:前后端都对 facts 做动态迭代/索引(后端 Object.entries / cast、
 * 扩展 facts[k]),无一方依赖结构化字段访问 —— 宽松 Record 统一两端且零结构化损失,
 * 免去强类型收窄的「界外 key 静默丢失」风险(沿用扩展端既有 `Record<string,string>`)。
 */
export interface PendingTopic {
	id: string;
	sourceUrl: string;
	siteName: string;
	title: string;
	rawContent?: {
		title: string;
		body: string;
		url: string;
		metadata?: Record<string, string>;
	};
	facts: Record<string, string>;
	confidence: number;
	score?: number;
	status: "pending" | "approved" | "rejected";
	rejectedReason?: RejectionReason;
	coverImageUrl?: string;
	/** 质量分低于 fold_threshold 时由后端路由层标记折叠（route 注入,非存储字段）。 */
	folded?: boolean;
	/** 预格式化的 web 富化文本（route 由 enrichment 派生,非存储字段）。 */
	enrichmentText?: string;
	/** 提炼模式:strict=structured output;fallback=json_object 兼容模式。 */
	extractionMode?: "strict" | "fallback";
	domain?: "acg" | "gossip";
	/** 入池前验证关结果（逐项判定/原因，供 UI 标红；U3）。 */
	verification?: VerificationResult;
	/** 内容指纹（跨 URL 去重；U3）。 */
	contentFingerprint?: string;
	/** 人工二次核对通过时间戳；非空=已核对（进题材池）；U4。 */
	verifiedAt?: string;
	createdAt: string;
	updatedAt: string;
}

/** AI 评审单维度结果。 */
export interface ReviewDimension {
	name: string;
	pass: boolean;
	reason?: string;
}

/** AI 评审 LLM 响应结果（Phase 3）。 */
export interface ReviewResult {
	ok: boolean;
	dimensions?: ReviewDimension[];
}

export type GenerateDraftResponse =
	| {
			ok: true;
			draft: ContentDraft;
			/** 模型叙事槽位;扩展端据此重新组装(re-assemble)。旧响应可能缺省。 */
			slots?: DraftSlots;
			llmCostTokens?: {
				prompt: number;
				completion: number;
				estimated?: boolean;
			};
			/** 质量警告（非阻塞，供 UI 提示）。 */
			qualityWarnings?: Array<{ name: string; message: string }>;
	  }
	| {
			ok: false;
			error: string;
			kind?: "no-key" | "network" | "format" | "grounding";
	  };
