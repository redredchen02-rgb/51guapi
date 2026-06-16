import type { RejectionReason } from "@51guapi/shared";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import {
	deletePendingTopic,
	listPendingTopics,
	loadPendingTopic,
	type PendingStatus,
	type PendingTopic,
	savePendingTopic,
	updatePendingTopicStatus,
} from "../scraper/pending-store.js";
import { formatEnrichmentForPrompt } from "../scraper/web-enricher.js";
import { err } from "../utils/error-response.js";
import { generateId } from "../utils/generate-id.js";
import {
	CreatePendingBody as CreatePendingBodySchema,
	PendingIdParams as PendingIdParamsSchema,
	UpdatePendingBody as UpdatePendingBodySchema,
} from "../utils/schemas.js";

/** 把后端 PendingTopic 转成 API 响应格式，附加预格式化的 enrichmentText 字段。 */
function toApiTopic(
	t: PendingTopic,
): PendingTopic & { enrichmentText?: string } {
	const enrichmentText = t.enrichment
		? formatEnrichmentForPrompt(t.enrichment) || undefined
		: undefined;
	return { ...t, enrichmentText };
}

const VALID_REJECTION_REASONS = new Set<RejectionReason>([
	"duplicate",
	"quality",
	"topic_mismatch",
	"missing_facts",
	"other",
]);

const VALID_STATUSES_SET = new Set<string>(["pending", "approved", "rejected"]);

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

			const topics =
				foldThreshold !== undefined && !Number.isNaN(foldThreshold)
					? rawTopics.map((t) => ({
							...t,
							folded: (t.score ?? 0) < foldThreshold,
						}))
					: rawTopics;

			return { ok: true, topics: topics.map(toApiTopic) };
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

			if (body.status) {
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

				const updated = await updatePendingTopicStatus(
					id,
					body.status as PendingStatus,
					body.rejectedReason,
				);
				if (!updated) return err(reply, 404, "Pending topic not found");
				return { ok: true, topic: updated };
			}

			// Partial update for facts/confidence
			const topic = await loadPendingTopic(id);
			if (!topic) return err(reply, 404, "Pending topic not found");

			if (body.facts) topic.facts = body.facts;
			if (body.confidence !== undefined) topic.confidence = body.confidence;
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
