// Shared types and utilities for 吃瓜小帮手 (51guapi) monorepo

export { toDraft } from "./draft.js";
export type { ExportedDraft, ExportFormat } from "./export.js";
export {
	assembleDraftJSON,
	assembleDraftMarkdown,
	EXPORT_SCHEMA_VERSION,
} from "./export.js";
export type { FactKey, FactsBlock, FactTarget, ParsedTopic } from "./facts.js";
export {
	applyPromptTemplate,
	CORE_FACT_KEYS,
	FACT_ORDER,
	FACT_TARGET,
	factUrls,
	formatFactsForPrompt,
	isEmptyFacts,
	parseTopicLine,
} from "./facts.js";
export type { FetchWithTimeoutOptions } from "./fetch.js";
export { fetchWithTimeout } from "./fetch.js";
export {
	DEFAULT_FIELD_MAPPING,
	isValidFieldMapping,
	VALID_FIELD_TYPES,
} from "./field-mapping.js";
export type { GossipFactKey, GossipFactsBlock } from "./gossip-facts.js";
export { GOSSIP_FACT_KEYS, GOSSIP_FACTS_SCHEMA } from "./gossip-facts.js";
export type { AssembledDraft, DraftSlots } from "./post-assembler.js";
export {
	assembleDraft,
	containsPlaceholder,
	esc,
	PLACEHOLDER,
	sanitizeToPlainText,
} from "./post-assembler.js";
export type { QualityCheck, QualityVerdict } from "./quality-gate.js";
export { evaluateQuality } from "./quality-gate.js";
export type {
	ContentDraft,
	DraftStatus,
	FewShotPair,
	FieldDefinition,
	FieldFillResult,
	FieldMapping,
	FieldType,
	GenerateDraftResponse,
	RejectionReason,
	ReviewDimension,
	ReviewResult,
	Settings,
} from "./types.js";
export type { CategoryOption } from "./vocab.js";
export { CATEGORY_VOCAB, normalizeCategory } from "./vocab.js";
