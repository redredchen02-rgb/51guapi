// Shared types and utilities for 吃瓜小帮手 (51guapi) monorepo

export { toDraft } from "./draft.js";
export type { ExportedDraft, ExportFormat, TopicForCSV } from "./export.js";
export {
	assembleDraftJSON,
	assembleDraftMarkdown,
	assembleTopicsCSV,
	EXPORT_SCHEMA_VERSION,
	escapeCsv,
} from "./export.js";
export type { FactKey, FactsBlock, ParsedTopic } from "./facts.js";
export {
	applyPromptTemplate,
	CORE_FACT_KEYS,
	FACT_ORDER,
	factUrls,
	formatFactsForPrompt,
	isEmptyFacts,
	parseTopicLine,
} from "./facts.js";
export type { FetchWithTimeoutOptions } from "./fetch.js";
export { fetchWithTimeout } from "./fetch.js";
export type { GossipFactKey, GossipFactsBlock } from "./gossip-facts.js";
export {
	GOSSIP_FACT_KEYS,
	GOSSIP_FACTS_SCHEMA,
	gossipFactUrls,
} from "./gossip-facts.js";
export {
	countThemes,
	factThemes,
	normalizeCategory,
	OTHER_THEME,
	parseThemes,
	THEME_ALLOWLIST,
} from "./gossip-theme.js";
export type {
	FreshnessResult,
	GroundingResult,
	ValidityResult,
	VerificationResult,
	VerifyConfig,
	VerifyDecision,
	VerifyInput,
} from "./gossip-verify.js";
export {
	computeContentFingerprint,
	DEFAULT_FINGERPRINT_FIELDS,
	FINGERPRINT_FIELD_ALLOWLIST,
	isWithinWindow,
	verifyCrawledTopic,
} from "./gossip-verify.js";
export type { LinkCheck } from "./link-source.js";
export {
	extractLinks,
	hasUnsourcedLink,
	normalizeUrl,
	verifyLinks,
} from "./link-source.js";
export type { AssembledDraft, DraftSlots } from "./post-assembler.js";
export {
	assembleGossipDraft,
	containsPlaceholder,
	PLACEHOLDER,
	sanitizeToPlainText,
} from "./post-assembler.js";
export type { QualityCheck, QualityVerdict } from "./quality-gate.js";
export { evaluateQuality } from "./quality-gate.js";
export type {
	ContentDraft,
	DraftStatus,
	FewShotPair,
	GenerateDraftResponse,
	PendingTopic,
	RejectionReason,
	ReviewDimension,
	ReviewResult,
	Settings,
} from "./types.js";
