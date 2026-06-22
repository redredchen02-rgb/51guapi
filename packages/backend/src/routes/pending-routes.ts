import type { GossipFactsBlock, RejectionReason } from "@51guapi/shared";
import { countThemes, parseThemes, verifyCrawledTopic } from "@51guapi/shared";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { loadVerifyConfig } from "../scraper/gossip-verify-config.js";
import {
	deletePendingTopic,
	listPendingTopics,
	loadPendingTopic,
	type PendingStatus,
	type PendingTopic,
	savePendingTopic,
} from "../scraper/pending-store.js";
import { err } from "../utils/error-response.js";
import { generateId } from "../utils/generate-id.js";
import {
	CreatePendingBody as CreatePendingBodySchema,
	PendingIdParams as PendingIdParamsSchema,
	UpdatePendingBody as UpdatePendingBodySchema,
} from "../utils/schemas.js";

/** 把后端 PendingTopic 转成 API 响应格式，附加提炼模式字段。 */
function toApiTopic(t: PendingTopic): PendingTopic & {
	extractionMode?: "strict" | "fallback";
} {
	const rawMode = t.rawContent?.metadata?.extractionMode;
	const extractionMode =
		rawMode === "strict" || rawMode === "fallback" ? rawMode : undefined;
	return { ...t, extractionMode };
}

const VALID_REJECTION_REASONS = new Set<RejectionReason>([
	"duplicate",
	"quality",
	"topic_mismatch",
	"missing_facts",
	"other",
]);

const VALID_STATUSES_SET = new Set<string>(["pending", "approved", "rejected"]);

function rerunVerification(topic: PendingTopic): void {
	const rc = topic.rawContent;
	if (!rc) return;
	const rawText = `${rc.title ?? ""}\n${(rc.body ?? "").replace(/<[^>]*>/g, " ")}`;
	topic.verification = verifyCrawledTopic({
		facts: topic.facts as GossipFactsBlock,
		rawText,
		publishedTime: rc.metadata?.publishedTime,
		now: Date.now(),
		config: loadVerifyConfig(),
	});
	topic.contentFingerprint = topic.verification.fingerprint;
}

export async function registerPendingRoutes(
	app: FastifyInstance,
): Promise<void> {
	// 列出所有待审核选题（可按 status 筛选、score 排序、fold_threshold 折叠低分）
	app.get<{
		Querystring: {
			limit?: string;
			status?: string;
			sort_by?: string;
			fold_threshold?: string;
			domain?: string;
			theme?: string;
			verified?: string;
		};
	}>(
		"/api/v1/pending-topics",
		{
			schema: {
				querystring: Type.Object({
					limit: Type.Optional(Type.String()),
					status: Type.Optional(Type.String()),
					sort_by: Type.Optional(Type.String()),
					fold_threshold: Type.Optional(Type.String()),
					domain: Type.Optional(Type.String()),
					// U5 题材过滤（按归一化的 熱度標籤）；U4 verified=true 只取已核对（题材池）。
					theme: Type.Optional(Type.String()),
					verified: Type.Optional(Type.String()),
				}),
			},
		},
		async (request) => {
			const limit = Math.min(
				Math.max(Number(request.query.limit) || 50, 1),
				200,
			);
			const rawStatus = request.query.status;
			const status: PendingStatus | undefined =
				rawStatus !== undefined && VALID_STATUSES_SET.has(rawStatus)
					? (rawStatus as PendingStatus)
					: undefined;
			const sortBy =
				request.query.sort_by === "score"
					? ("score" as const)
					: ("created_at" as const);
			const foldThreshold =
				request.query.fold_threshold !== undefined
					? Number(request.query.fold_threshold)
					: undefined;
			const domain =
				request.query.domain === "acg" || request.query.domain === "gossip"
					? (request.query.domain as "acg" | "gossip")
					: undefined;

			const rawTopics = await listPendingTopics(limit, status, sortBy, domain);

			// U4 verified 过滤（题材池 = 已人工核对的）；U5 题材过滤（按归一化 熱度標籤）。
			const wantVerified =
				request.query.verified === "true"
					? true
					: request.query.verified === "false"
						? false
						: undefined;
			const theme = request.query.theme?.trim() || undefined;

			let filtered = rawTopics;
			if (wantVerified !== undefined) {
				filtered = filtered.filter((t) =>
					wantVerified ? t.verifiedAt != null : t.verifiedAt == null,
				);
			}
			if (theme) {
				filtered = filtered.filter((t) =>
					parseThemes(
						(t.facts as Partial<GossipFactsBlock>).熱度標籤 ?? null,
					).includes(theme),
				);
			}

			const topics =
				foldThreshold !== undefined && !Number.isNaN(foldThreshold)
					? filtered.map((t) => ({
							...t,
							folded: (t.score ?? 0) < foldThreshold,
						}))
					: filtered;

			return { ok: true, topics: topics.map(toApiTopic) };
		},
	);

	// U5 题材计数（题材选择器用）：默认只统计**已核对**的吃瓜（题材池）。
	app.get<{ Querystring: { verified?: string } }>(
		"/api/v1/pending-topics/themes",
		{
			schema: {
				querystring: Type.Object({ verified: Type.Optional(Type.String()) }),
			},
		},
		async (request) => {
			const onlyVerified = request.query.verified !== "false"; // 默认 true
			const gossip = await listPendingTopics(200, undefined, "score", "gossip");
			const available = gossip.filter((t) => t.status === "pending");
			const pool = onlyVerified
				? available.filter((t) => t.verifiedAt != null)
				: available;
			const themes = countThemes(pool.map((t) => t.facts as GossipFactsBlock));
			return { ok: true, themes };
		},
	);

	// 获取单个待审核选题
	app.get<{ Params: { id: string } }>(
		"/api/v1/pending-topics/:id",
		{
			schema: {
				params: PendingIdParamsSchema,
			},
		},
		async (request, reply) => {
			const topic = await loadPendingTopic(request.params.id);
			if (!topic) return err(reply, 404, "Pending topic not found");
			return { ok: true, topic: toApiTopic(topic) };
		},
	);

	// 手动创建待审核选题
	app.post<{
		Body: {
			sourceUrl: string;
			siteName: string;
			title: string;
			facts?: Record<string, unknown>;
			confidence?: number;
		};
	}>(
		"/api/v1/pending-topics",
		{
			schema: {
				body: CreatePendingBodySchema,
			},
		},
		async (request, reply) => {
			const { sourceUrl, siteName, title, facts, confidence } = request.body;

			if (!sourceUrl || !siteName || !title) {
				return err(
					reply,
					400,
					"Missing required fields: sourceUrl, siteName, title",
				);
			}

			const now = new Date().toISOString();
			const id = generateId("pending");
			const topic: PendingTopic = {
				id,
				sourceUrl,
				siteName,
				title,
				facts: (facts ?? {}) as PendingTopic["facts"],
				confidence: confidence ?? 0,
				status: "pending",
				createdAt: now,
				updatedAt: now,
			};

			await savePendingTopic(topic);
			return { ok: true, topic };
		},
	);

	// 更新待审核选题（approve / reject）
	app.patch<{
		Params: { id: string };
		Body: {
			status?: string;
			rejectedReason?: string;
			facts?: Record<string, unknown>;
			confidence?: number;
			verified?: boolean;
		};
	}>(
		"/api/v1/pending-topics/:id",
		{
			schema: {
				params: PendingIdParamsSchema,
				body: UpdatePendingBodySchema,
			},
		},
		async (request, reply) => {
			const { id } = request.params;
			const body = request.body;

			if (body.status !== undefined) {
				// 校验 status 必须是合法枚举值
				if (!VALID_STATUSES_SET.has(body.status)) {
					return err(
						reply,
						400,
						`Invalid status "${body.status}". Must be one of: ${[...VALID_STATUSES_SET].join(", ")}`,
					);
				}

				// 拒绝时校验 rejectedReason（若提供）必须是合法枚举值
				if (
					body.status === "rejected" &&
					body.rejectedReason !== undefined &&
					!VALID_REJECTION_REASONS.has(body.rejectedReason as RejectionReason)
				) {
					return err(
						reply,
						400,
						`Invalid rejectedReason "${body.rejectedReason}". Must be one of: ${[...VALID_REJECTION_REASONS].join(", ")}`,
					);
				}
			}

			// Partial update for facts/confidence/verified/status. A single PATCH may
			// carry edited facts plus status, so apply every valid field before saving.
			const topic = await loadPendingTopic(id);
			if (!topic) return err(reply, 404, "Pending topic not found");

			if (body.facts) {
				topic.facts = body.facts as PendingTopic["facts"];
				// 改值后对新值重跑 grounding（基准=不可变 rawContent）——防 UI 层 rewrite 旁路:
				// 不可只清红标，须让验证关重新判定新值是否溯源。
				rerunVerification(topic);
			}
			if (body.confidence !== undefined) topic.confidence = body.confidence;
			if (body.verified !== undefined) {
				// 人工二次核对：置/撤销 verifiedAt（题材池只收非空）。
				topic.verifiedAt = body.verified ? new Date().toISOString() : undefined;
			}
			if (body.status !== undefined) {
				topic.status = body.status as PendingStatus;
				topic.rejectedReason =
					topic.status === "rejected" ? body.rejectedReason : undefined;
				if (topic.status === "rejected") topic.verifiedAt = undefined;
			}
			await savePendingTopic(topic);
			return { ok: true, topic };
		},
	);

	// 删除待审核选题
	app.delete<{ Params: { id: string } }>(
		"/api/v1/pending-topics/:id",
		{
			schema: {
				params: PendingIdParamsSchema,
			},
		},
		async (request, reply) => {
			const topic = await loadPendingTopic(request.params.id);
			if (!topic) return err(reply, 404, "Pending topic not found");
			await deletePendingTopic(request.params.id);
			return { ok: true };
		},
	);
}
