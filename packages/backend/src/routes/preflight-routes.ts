import type { FastifyInstance } from "fastify";
import { checkEnv } from "../config/env-check.js";

// 只读 preflight 自检路由(PR-A Unit 3)。
//
// 报告「后端能自评的子集」(env / CORS),且**只报布尔 / expected-vs-actual**,
// 绝不回显 JWT_SECRET / LLM_API_KEY / CORS_ORIGIN 等明文 —— 否则鉴权后的报告
// 本身就成了泄密面。
//
// 必须注册在 preHandler 之后(需 JWT),且不进 PUBLIC_ROUTES、不与 healthz/metrics 同组。

interface PreflightCheck {
	id: string;
	label: string;
	pass: boolean;
}

interface PreflightResidual {
	id: string;
	label: string;
}

export async function registerPreflightRoutes(
	app: FastifyInstance,
): Promise<void> {
	app.get("/api/v1/preflight", async () => {
		const env = process.env;
		const errors = checkEnv(env);
		const hasErr = (prefix: string) => errors.some((e) => e.startsWith(prefix));

		// CORS_ORIGIN:只报「是否设置且非通配」,不回显其值。
		const corsConfigured = !hasErr("CORS_ORIGIN");

		const checks: PreflightCheck[] = [
			{
				id: "jwt-secret",
				label: "JWT_SECRET 已设置且足够强",
				pass: !hasErr("JWT_SECRET"),
			},
			{
				id: "jwt-admin-hash",
				label: "JWT_ADMIN_PASSWORD_HASH 格式有效",
				pass: !hasErr("JWT_ADMIN_PASSWORD_HASH"),
			},
			{
				id: "cors-origin-configured",
				label: "CORS_ORIGIN 已设置且非通配 '*'",
				pass: corsConfigured,
			},
			{
				id: "env-failclosed",
				label: "fail-closed env 校验整体通过",
				pass: errors.length === 0,
			},
		];

		// 不可逆残留:后端无法替操作者验证的部分(只列出)。
		const residuals: PreflightResidual[] = [
			{
				id: "real-backend-smoke",
				label: "真后台人工冒烟(动态提交 handler 实发一次)",
			},
			{
				id: "extension-reload",
				label: "chrome://extensions 重载扩展并刷新目标页",
			},
		];

		return { ok: true, checks, residuals };
	});
}
