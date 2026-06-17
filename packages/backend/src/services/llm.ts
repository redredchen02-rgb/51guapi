// 门面(barrel):本文件已外科拆分为 fetch-backoff / draft-gen / draft-review /
// draft-rewrite 四个内聚模块。此处 re-export 全部原公开符号,保证外部 import 路径、
// 符号名、签名一字不变(零回归面、可单文件回滚)。逻辑实体在各子模块,见其文件头。
//
// 拓扑:fetch-backoff ← draft-gen ← draft-review / draft-rewrite(干净 DAG,无循环)。

export {
	buildRequest,
	chatCompletionsUrl,
	DRAFT_SLOTS_SCHEMA,
	generateDraft,
	type ListModelsResult,
	listModels,
	modelsUrl,
	slotsFromParsed,
} from "./draft-gen.js";
export {
	buildReviewPrompt,
	extractUsage,
	type ReviewDraftResult,
	reviewDraftLlm,
} from "./draft-review.js";
export {
	buildRewritePrompt,
	type RewriteDraftResult,
	rewriteDraftLlm,
} from "./draft-rewrite.js";
export type { LlmDeps } from "./fetch-backoff.js";
