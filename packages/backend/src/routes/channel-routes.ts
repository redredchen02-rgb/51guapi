import type { FastifyInstance } from "fastify";
import {
	assertHostResolvesPublic,
	type Channel,
	deleteChannel,
	insertChannel,
	listChannels,
	normalizeChannelHost,
} from "../scraper/channel-store.js";
import { verifyAdminPassword } from "../services/password.js";
import { err } from "../utils/error-response.js";
import {
	CreateChannelResponse,
	DeleteOkResponse,
	ListChannelsResponse,
} from "../utils/schemas.js";

// U6 渠道管理路由 — 操作者持续新增爬取渠道,域名动态进 SSRF allowlist。
//
// 安全约束(对应计画 6 条):
// 2) 写入需人手确认手势:POST 须带 header `x-operator-confirm: 1` + body `confirm: true`。
//    LLM/爬取管线即便能发 HTTP 也不带此手势(它们走 generic-adapter,从不调本路由)。
//    本路由不入 PUBLIC_ROUTES → 仍受全局 JWT preHandler 保护。
// 1) 入库即解析校验:assertHostResolvesPublic 当场 DNS 解析 + 私网/元数据 IP 拒。
// 4) 钉死 https/拒通配/IDN punycode + 拒同形:由 normalizeChannelHost 把关,记审计栏位。
// 5) 单渠道路径前缀/体积上限:随渠道存储,generic-adapter 抓取时强制(U6 P0)。
//    maxDepth 为翻页页数上限:list-discovery 跟随「下一页」最多 N 页(预设 1=单页),scheduler 与 discover 路由生效。
// 6) fail-closed + 数量上限:insertChannel 内 MAX_CHANNELS 守。

const CONFIRM_HEADER = "x-operator-confirm";

interface CreateBody {
	channel?: string; // URL 或裸域名
	displayName?: string;
	confirm?: boolean;
	adminPassword?: string; // step-up:管理员口令重验
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

	// POST /api/v1/channels — 新增渠道(带人手确认手势 + 入库解析校验)
	app.post<{ Body: CreateBody }>(
		"/api/v1/channels",
		{
			schema: {
				response: { 200: CreateChannelResponse, 201: CreateChannelResponse },
			},
		},
		async (request, reply) => {
			// 2) 人手确认手势:header + body 双重,缺一即拒。爬取管线/LLM 不会带。
			const headerConfirm = request.headers[CONFIRM_HEADER];
			const confirmed =
				(headerConfirm === "1" || headerConfirm === "true") &&
				request.body?.confirm === true;
			if (!confirmed) {
				return err(
					reply,
					403,
					"新增渠道需操作者确认手势(缺 x-operator-confirm 头或 confirm 标志)",
					"confirmation_required",
				);
			}

			// 3) 口令 step-up:除 JWT 外须通过管理员口令重验。被窃 token 单独写不了
			//    allowlist。必须早退——在任何 DNS 解析/写库之前,无权请求不得触发出站解析。
			if (!verifyAdminPassword(request.body?.adminPassword)) {
				return err(
					reply,
					403,
					"新增渠道需管理员口令重验(step-up):缺少或错误的 adminPassword",
					"step_up_required",
				);
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

			// 审计:created_by 取自 JWT(若中间件挂载),否则 'operator'。
			const createdBy =
				(request as { user?: { sub?: string } }).user?.sub ?? "operator";

			const result = insertChannel({
				hostname: norm.hostname,
				displayName: displayName ?? norm.hostname,
				pathPrefix,
				maxDepth,
				maxBytes,
				createdBy,
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
			const ok = deleteChannel(request.params.id);
			if (!ok) return err(reply, 404, "渠道不存在");
			return { ok: true };
		},
	);
}
