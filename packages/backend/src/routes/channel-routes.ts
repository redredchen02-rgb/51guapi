import type { FastifyInstance } from "fastify";
import {
	assertHostResolvesPublic,
	type Channel,
	deleteChannel,
	insertChannel,
	listChannels,
	normalizeChannelHost,
} from "../scraper/channel-store.js";
import { getMutationPin } from "../services/mutation-pin.js";
import { err } from "../utils/error-response.js";
import {
	CreateChannelResponse,
	DeleteOkResponse,
	ListChannelsResponse,
} from "../utils/schemas.js";

// 渠道管理路由 — 操作者持续新增爬取渠道,域名动态进 SSRF allowlist。
//
// 自用模式(2026-06-18,plan docs/plans/2026-06-18-003):有意移除「确认手势 + 管理员
// 口令 step-up」两道写入闸,加渠道只需有效 JWT。这是对 2026-06-17-002 R3 越权防线的
// **有意撤除**(单操作者自用工具),**勿当 bug 加回**。本路由不入 PUBLIC_ROUTES → 仍受
// 全局 JWT preHandler 保护。
//
// 2026-06-24 安全加固: 引入 x-guapi-mutation-pin 验证，防范 automated script / XSS / Prompt Injection 越权修改 allowlist。

interface CreateBody {
	channel?: string; // URL 或裸域名
	displayName?: string;
	pathPrefix?: string;
	maxDepth?: number;
	maxBytes?: number;
	reason?: string;
}

interface ChannelParams {
	id: string;
}

function toDto(c: Channel) {
	return {
		id: c.id,
		hostname: c.hostname,
		displayName: c.displayName,
		pathPrefix: c.pathPrefix,
		maxDepth: c.maxDepth,
		maxBytes: c.maxBytes,
		createdBy: c.createdBy,
		reason: c.reason,
		createdAt: c.createdAt,
	};
}

export function registerChannelRoutes(app: FastifyInstance): void {
	// GET /api/v1/channels — 列出渠道
	app.get(
		"/api/v1/channels",
		{ schema: { response: { 200: ListChannelsResponse } } },
		async () => {
			return { ok: true, channels: listChannels().map(toDto) };
		},
	);

	// POST /api/v1/channels — 新增渠道(入库解析校验:归一 + DNS 公网)
	app.post<{ Body: CreateBody }>(
		"/api/v1/channels",
		{
			schema: {
				response: { 200: CreateChannelResponse, 201: CreateChannelResponse },
			},
		},
		async (request, reply) => {
			const clientPin = request.headers["x-guapi-mutation-pin"];
			const expectedPin = getMutationPin();
			if (clientPin !== expectedPin) {
				return err(reply, 403, "无效的 Mutation PIN，请在扩展端重新输入");
			}

			const { channel, displayName, pathPrefix, maxDepth, maxBytes, reason } =
				request.body ?? {};
			if (!channel || typeof channel !== "string") {
				return err(reply, 400, "缺少渠道域名");
			}
			if (displayName && displayName.length > 200) {
				return err(reply, 400, "displayName 过长(最多 200 字)");
			}

			// 4) 归一:https 钉死 / 拒通配 / IDN→punycode + 拒同形。
			const norm = normalizeChannelHost(channel);
			if (norm.error || !norm.hostname) {
				return err(reply, 400, norm.error ?? "非法渠道域名");
			}

			// 1) 入库即解析校验:DNS 解析 + 私网/元数据 IP 拒。
			try {
				await assertHostResolvesPublic(norm.hostname);
			} catch (e) {
				return err(reply, 400, e instanceof Error ? e.message : String(e));
			}

			const result = insertChannel({
				hostname: norm.hostname,
				displayName: displayName ?? norm.hostname,
				pathPrefix,
				maxDepth,
				maxBytes,
				createdBy: "operator",
				reason: reason ?? "",
			});
			if (result.error || !result.channel) {
				return err(reply, 409, result.error ?? "写入失败");
			}
			// 去重:已存在则回 200,否则 201。
			reply.code(result.deduped ? 200 : 201);
			return {
				ok: true,
				channel: toDto(result.channel),
				deduped: !!result.deduped,
			};
		},
	);

	// DELETE /api/v1/channels/:id — 删除渠道(即从 allowlist 移除)
	app.delete<{ Params: ChannelParams }>(
		"/api/v1/channels/:id",
		{ schema: { response: { 200: DeleteOkResponse } } },
		async (request, reply) => {
			const clientPin = request.headers["x-guapi-mutation-pin"];
			const expectedPin = getMutationPin();
			if (clientPin !== expectedPin) {
				return err(reply, 403, "无效的 Mutation PIN，请在扩展端重新输入");
			}

			const ok = deleteChannel(request.params.id);
			if (!ok) return err(reply, 404, "渠道不存在");
			return { ok: true };
		},
	);
}
