import { Type } from "@sinclair/typebox";

// ── Shared ────────────────────────────────────────────
export const OkStatus = Type.Literal(true);
export const ErrorBody = Type.Object({
	ok: Type.Literal(false),
	error: Type.String(),
	kind: Type.Optional(Type.String()),
});

// ── Settings ──────────────────────────────────────────
export const SettingsSchema = Type.Object({
	endpoint: Type.String(),
	model: Type.String(),
	promptTemplate: Type.Optional(Type.String()),
	facts: Type.Optional(Type.String()),
	fewShot: Type.Optional(Type.String()),
	extraInstructions: Type.Optional(Type.String()),
});

// ── FactsBlock ────────────────────────────────────────
export const FactsBlockSchema = Type.Object({
	intro: Type.Optional(Type.String()),
	highlights: Type.Optional(Type.Array(Type.String())),
	characters: Type.Optional(Type.String()),
	workTitle: Type.Optional(Type.String()),
	episodeNumber: Type.Optional(Type.String()),
});

// ── Drafts ────────────────────────────────────────────
export const GenerateDraftBody = Type.Object({
	prompt: Type.String({ minLength: 1 }),
	settings: SettingsSchema,
	facts: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	enrichment: Type.Optional(Type.String()),
});

// 模型叙事槽位(供扩展端重新组装;字段须与 shared/post-assembler.ts 的 DraftSlots 一致)。
export const DraftSlotsSchema = Type.Object({
	titleSuffix: Type.Optional(Type.String()),
	subtitle: Type.Optional(Type.String()),
	intro: Type.String(),
	highlights: Type.String(),
	outro: Type.Optional(Type.String()),
});

export const GenerateDraftResponse = Type.Object({
	ok: OkStatus,
	// 可选:Fastify+TypeBox 会剥除 schema 之外的响应字段,故必须在此声明,否则 slots 被静默丢弃。
	slots: Type.Optional(DraftSlotsSchema),
	draft: Type.Object({
		id: Type.String(),
		title: Type.String(),
		subtitle: Type.String(),
		category: Type.String(),
		coverImageUrl: Type.String(),
		body: Type.String(),
		tags: Type.Array(Type.String()),
		description: Type.String(),
		status: Type.String(),
		createdAt: Type.String(),
	}),
});

export const ReviewDraftBody = Type.Object({
	draft: Type.Object({
		id: Type.String(),
		title: Type.String(),
		subtitle: Type.String(),
		category: Type.String(),
		coverImageUrl: Type.String(),
		body: Type.String(),
		tags: Type.Array(Type.String()),
		description: Type.String(),
		status: Type.String(),
		createdAt: Type.String(),
	}),
	criteriaPrompt: Type.Optional(Type.String()),
	settings: SettingsSchema,
});

export const RewriteDraftBody = Type.Object({
	draft: Type.Object({
		id: Type.String(),
		title: Type.String(),
		subtitle: Type.String(),
		category: Type.String(),
		coverImageUrl: Type.String(),
		body: Type.String(),
		tags: Type.Array(Type.String()),
		description: Type.String(),
		status: Type.String(),
		createdAt: Type.String(),
	}),
	failedDims: Type.Array(Type.String()),
	facts: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	settings: SettingsSchema,
});

// ── Auth ──────────────────────────────────────────────
export const LoginBody = Type.Object({
	// 自用模式:免密登入,password 可选且被忽略。maxLength 仍作为通用体积上限。
	password: Type.Optional(Type.String({ maxLength: 1024 })),
});

export const LoginResponse = Type.Object({
	ok: OkStatus,
	token: Type.String(),
});

export const AuthStatusResponse = Type.Object({
	ok: OkStatus,
	authenticated: Type.Boolean(),
});

// ── Models ────────────────────────────────────────────
export const ModelsResponse = Type.Object({
	ok: OkStatus,
	models: Type.Optional(Type.Array(Type.Unknown())),
});

// ── Pending ──────────────────────────────────────────
export const PendingIdParams = Type.Object({
	id: Type.String({ minLength: 1 }),
});

export const CreatePendingBody = Type.Object({
	sourceUrl: Type.String({ minLength: 1 }),
	siteName: Type.String({ minLength: 1 }),
	title: Type.String({ minLength: 1 }),
	facts: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});

export const UpdatePendingBody = Type.Object({
	status: Type.Optional(
		Type.Union([
			Type.Literal("pending"),
			Type.Literal("approved"),
			Type.Literal("rejected"),
		]),
	),
	rejectedReason: Type.Optional(Type.String()),
	facts: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
	// 人工二次核对（U4）：true=置 verifiedAt（进题材池），false=撤销回未核对。
	verified: Type.Optional(Type.Boolean()),
});

// ── Gossip ──────────────────────────────────────────
export const GossipSiteParams = Type.Object({
	id: Type.String({ minLength: 1 }),
});

export const GossipSiteCreate = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 200 }),
	listUrl: Type.String({ minLength: 1 }),
});

export const GossipFromUrlBody = Type.Object({
	url: Type.String({ minLength: 1 }),
	siteName: Type.String({ minLength: 1, maxLength: 200 }),
	// 时间窗（天）：抓取后若发布时间早于 now-windowDays 则跳过不入池。
	// 服务端范围校验(拒非法/超大)——既是输入控制也防成本放大(security-lens)。
	windowDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
});

// ── Health & Metrics ───────────────────────────────
export const HealthzResponse = Type.Object({
	ok: Type.Literal(true),
	uptime: Type.Number(),
	scheduler: Type.Object({
		running: Type.Boolean(),
		jobCount: Type.Number(),
	}),
	database: Type.Object({
		healthy: Type.Boolean(),
	}),
	memory: Type.Object({
		heapUsed: Type.Number(),
	}),
	quality: Type.Object({
		avgScore: Type.Number(),
		passRate: Type.Number(),
		totalGenerations: Type.Number(),
	}),
});

// ── Scraper Auto-Generate ────────────────────────────
export const AutoGenerateBody = Type.Object({
	minConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
	maxItems: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
	enableEnrichment: Type.Optional(Type.Boolean()),
	legacy: Type.Optional(Type.Literal("acg")),
});

// ── Scraper ──────────────────────────────────────────
export const TriggerScrapeBody = Type.Object({
	siteName: Type.String({ minLength: 1 }),
	url: Type.Optional(Type.String()),
	legacy: Type.Optional(Type.Literal("acg")),
});

// ── Prompts ──────────────────────────────────────────
const FewShotPairSchema = Type.Object({
	input: Type.String(),
	output: Type.String(),
});

export const CreatePromptBody = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 100 }),
	template: Type.String({ minLength: 1, maxLength: 50000 }),
	fewShotPairs: Type.Optional(Type.Array(FewShotPairSchema)),
	model: Type.Optional(Type.String({ maxLength: 100 })),
});

export const UpdatePromptBody = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
	template: Type.Optional(Type.String({ minLength: 1, maxLength: 50000 })),
	fewShotPairs: Type.Optional(Type.Array(FewShotPairSchema)),
	model: Type.Optional(Type.String({ maxLength: 100 })),
});

// ── Channels ──────────────────────────────────────────
// 须与 channel-routes.ts 的 toDto() 字段逐一对齐(response schema 会按此序列化/剥字段)。
export const ChannelDto = Type.Object({
	id: Type.String(),
	hostname: Type.String(),
	displayName: Type.String(),
	pathPrefix: Type.String(),
	maxDepth: Type.Number(),
	maxBytes: Type.Number(),
	createdBy: Type.String(),
	reason: Type.String(),
	createdAt: Type.String(),
});

export const ListChannelsResponse = Type.Object({
	ok: OkStatus,
	channels: Type.Array(ChannelDto),
});

export const CreateChannelResponse = Type.Object({
	ok: OkStatus,
	channel: ChannelDto,
	deduped: Type.Boolean(),
});

export const DeleteOkResponse = Type.Object({
	ok: OkStatus,
});

// ── Preflight ─────────────────────────────────────────
export const PreflightResponse = Type.Object({
	ok: OkStatus,
	checks: Type.Array(
		Type.Object({
			id: Type.String(),
			label: Type.String(),
			pass: Type.Boolean(),
		}),
	),
	residuals: Type.Array(
		Type.Object({
			id: Type.String(),
			label: Type.String(),
		}),
	),
});
