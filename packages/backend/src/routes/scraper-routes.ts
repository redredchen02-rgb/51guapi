import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import { scraperConfig } from "../scraper/scraper-config.js";
import { isHostAllowed, loadSSRFAllowlist } from "../scraper/ssrf-allowlist.js";
import { err } from "../utils/error-response.js";
import {
	AutoGenerateBody as AutoGenerateBodySchema,
	TriggerScrapeBody as TriggerScrapeBodySchema,
} from "../utils/schemas.js";

interface TriggerBody {
	siteName: string;
	url?: string;
	legacy?: "acg";
}

/**
 * 出站目标统一闸：覆盖 caller url / config.url / discovery pick 三来源，交给 adapter 前逐一校验。
 *   1. 拒 IP 字面：resolveAndPin 会放行解析为公网的 IP literal，故 IP-literal 须在路由输入层拒
 *      （allowlist 按 hostname 匹配，IP 字面绕过 host 命名空间）。
 *   2. isHostAllowed 复检：config.url 与 discovery pick 此前未过 allowlist（仅 caller url 过）。
 * 返回 { status, message }（调用方转错误响应）或 null（放行）。
 */
function _validateOutboundTarget(
	rawUrl: string,
): { status: number; message: string } | null {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		return { status: 400, message: "Invalid target URL format" };
	}
	if (parsed.username || parsed.password) {
		return { status: 400, message: "URL credentials not allowed" };
	}
	const host = parsed.hostname.replace(/^\[|\]$/g, ""); // 去 IPv6 方括号再判
	if (isIP(host) !== 0) {
		return {
			status: 403,
			message: `IP literal hosts are not allowed: ${parsed.hostname}`,
		};
	}
	if (!isHostAllowed(parsed, loadSSRFAllowlist())) {
		return {
			status: 403,
			message: `Target hostname blocked by SSRF allowlist: ${parsed.hostname}`,
		};
	}
	return null;
}

export async function registerScraperRoutes(
	app: FastifyInstance,
): Promise<void> {
	// Legacy ACG 手动抓取。当前吃瓜主流程使用 /api/v1/gossip/topics/from-url。
	app.post<{ Body: TriggerBody }>(
		"/api/v1/scraper/trigger",
		{
			config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
			schema: {
				body: TriggerScrapeBodySchema,
			},
		},
		async (_request, reply) => {
			return err(
				reply,
				410,
				"Legacy ACG scraper trigger is disabled.",
				"legacy-acg-disabled",
			);
		},
	);

	// 列出已注册的适配器
	app.get("/api/v1/scraper/adapters", async () => {
		const adapters = scraperConfig
			.listAdapters()
			.map((a: { name: string }) => ({
				name: a.name,
			}));
		return { ok: true, adapters };
	});

	// 列出已配置的站点
	app.get("/api/v1/scraper/sites", async () => {
		const sites = scraperConfig.listSiteConfigs();
		return { ok: true, sites };
	});

	// 自动批量生成草稿（含进度反馈）
	app.post<{
		Body: {
			minConfidence?: number;
			maxItems?: number;
			legacy?: "acg";
		};
	}>(
		"/api/v1/scraper/auto-generate",
		{
			schema: {
				body: AutoGenerateBodySchema,
			},
		},
		async (_request, reply) => {
			return err(
				reply,
				410,
				"Legacy ACG auto-generate is disabled.",
				"legacy-acg-disabled",
			);
		},
	);
}
