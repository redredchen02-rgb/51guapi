// 三层(side panel / background / content script)共享的类型定义。

/** Few-shot 范例对(结构化版)。source of truth；fewShotExamples 由此派生。 */
export interface FewShotPair {
	input: string;
	output: string;
}

/** 草稿在本插件内的生命周期状态(注意与后台表单的"显示/隐藏"状态 postStatus 区分)。 */
export type DraftStatus = "draft" | "filled" | "published";

/**
 * 一条内容草稿。AI 生成 title/subtitle/category/body/tags/description;
 * postStatus/publishedAt/mediaId 由人工在 side panel 填写或取默认值(非 AI 生成)。
 */
export interface ContentDraft {
	id: string;
	title: string;
	subtitle: string;
	/** 后台分类(对应 select[name=type] 的 value,如 "2"/"4")。 */
	category: string;
	/** 仅作预览参考,MVP 不填进表单(封面为 file 上传)。 */
	coverImageUrl: string;
	/** 正文 HTML(写入 Quill 前需消毒)。 */
	body: string;
	tags: string[];
	/** 描述/摘要(AI 生成)。 */
	description: string;
	/** 后台显示状态:'0'=隐藏,'1'=显示。 */
	postStatus: string;
	/** 发布时间 yyyy-MM-dd。 */
	publishedAt: string;
	/** 关联作品 id。 */
	mediaId: string;
	status: DraftStatus;
	/** ISO 时间戳。 */
	createdAt: string;
}

/** 字段填充策略类型。U0 确认本后台用到 text/textarea/quill/native-select/checkbox-multi/date。 */
export type FieldType =
	| "text"
	| "textarea"
	| "quill"
	| "native-select"
	| "checkbox-multi"
	| "date"
	| "custom-dropdown"
	| "tag-input";

/** 单个字段:稳定选择器 + 填充类型。 */
export interface FieldDefinition {
	selector: string;
	fieldType: FieldType;
	label?: string;
}

/** 草稿字段 → 页面元素的映射。键为 ContentDraft 的可填字段。 */
export type FieldMapping = Partial<
	Record<
		| "title"
		| "subtitle"
		| "category"
		| "body"
		| "tags"
		| "description"
		| "postStatus"
		| "publishedAt"
		| "mediaId",
		FieldDefinition
	>
>;

/**
 * 发布安全档位(自主发布器闸门)。
 * - 'off':今天的行为——背景永不发"准许",无任何提交路径。
 * - 'dry-run':跑完整流程但不发"准许",只产出"将发布什么"的报告。
 * - 'authorized':仅当目标 tab 的 host 命中授权名单才发"准许"。
 */
export type SafetyMode = "off" | "dry-run" | "authorized";

/** 用户可配置的设置(API key 单独存取,不在此对象内)。 */
export interface Settings {
	/** 大模型 endpoint(OpenAI 兼容 chat/completions),须为 https。 */
	endpoint: string;
	/** 模型名。 */
	model: string;
	/** prompt 模板,用户主题会注入其中。 */
	promptTemplate: string;
	/** 字段映射(可在设置页编辑)。 */
	fieldMapping: FieldMapping;
	/** 备用 LLM 端点(主端点失败时回退;undefined = 不启用 fallback)。 */
	fallbackModel?: { endpoint: string; model?: string };
	/** 51publisher 后端 URL（http://localhost:3001 等）;空=不启用后端双写。 */
	backendUrl?: string;
	/** Few-shot 范例原始字符串(后端 prompt 注入用)。派生自 fewShotPairs，或向前兼容旧存储。 */
	fewShotExamples?: string;
	/** 结构化 few-shot 范例列表；与 fewShotExamples 并存，fewShotPairs 为编辑源。 */
	fewShotPairs?: FewShotPair[];
}

// ---- 消息协议(side panel ↔ background ↔ content script) ----

/** 单字段填充结果。 */
export interface FieldFillResult {
	field: string;
	status: "filled" | "skipped" | "degraded";
	note?: string;
}

/** 发布结果(content 执行后回传 background,再回 side panel)。绝不含 key/CSRF/登录态。 */
export interface PublishResult {
	ok: boolean;
	/** 发布成功后的帖子 URL(若后台返回);回滚依据。 */
	url?: string;
	/** 结构化错误码,绝不带敏感串。 */
	error?: string;
	/** 是否 dry-run(走完流程但未真正提交)。 */
	dryRun: boolean;
	/** URL 来源:save 响应直取 / ID 推导 / 不可得。 */
	urlSource?: "from_save" | "derived_id" | "not_available";
}

export type RuntimeMessage =
	| { type: "GENERATE_DRAFT"; prompt: string }
	| { type: "FILL_PAGE"; draft: ContentDraft }
	// side panel → background:请求发布钉住的 tab(显式 tabId,绝不查 active)。
	| { type: "PUBLISH_PAGE"; tabId: number }
	// background → content:一次性"准许"。content 只在收到此消息时才触发提交。
	| { type: "PUBLISH_GRANT" }
	// side panel → background:批量编排(均显式 tabId,绝不查 active)。
	| { type: "RUN_BATCH"; topics: string[]; tabId: number }
	| { type: "APPROVE_BATCH"; tabId: number }
	| { type: "KILL_BATCH" }
	| { type: "RELEASE_QUARANTINE"; itemId: string }
	| { type: "GET_BATCH" }
	// side panel → background:标记操作者已手动修改该条草稿(直发率度量)。
	| { type: "MARK_ITEM_EDITED"; itemId: string }
	// side panel → content:轻量选择器漂移自检(R6 轻量)。
	| { type: "CHECK_SELECTORS" };

export type GenerateDraftResponse =
	| {
			ok: true;
			draft: ContentDraft;
			llmCostTokens?: {
				prompt: number;
				completion: number;
				estimated?: boolean;
			};
	  }
	| { ok: false; error: string; kind?: "no-key" | "network" | "format" };

export type FillPageResponse =
	| { ok: true; results: FieldFillResult[] }
	| { ok: false; error: string };

export type PublishPageResponse = PublishResult;
