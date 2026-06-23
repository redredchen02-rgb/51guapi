import type { FastifyInstance } from "fastify";
import { checkEnv } from "../config/env-check.js";
import { PreflightResponse } from "../utils/schemas.js";

// 只读 preflight 自检路由。报告「后端能自评的子集」(env / CORS),
// 只报布尔,绝不回显 LLM_API_KEY / CORS_ORIGIN 等明文。

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
	app.get(
		"/api/v1/preflight",
		{ schema: { response: { 200: PreflightResponse } } },
		async () => {
			const env = process.env;
			const errors = checkEnv(env);
			const hasErr = (prefix: string) =>
				errors.some((e) => e.startsWith(prefix));

			const checks: PreflightCheck[] = [
				{
					id: "cors-origin-configured",
					label: "CORS_ORIGIN 已设置且非通配 '*'",
					pass: !hasErr("CORS_ORIGIN"),
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
					id: "extension-load-smoke",
					label: "Chrome 扩展人工加载与侧边栏冒烟",
				},
				{
					id: "crawl-target-smoke",
					label: "真实抓取目标人工冒烟",
				},
				{
					id: "export-artifact-review",
					label: "导出 JSON / Markdown 人工抽查",
				},
			];

			return { ok: true, checks, residuals };
		},
	);
}
