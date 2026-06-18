import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { auditLogin } from "../services/audit-log.js";
import { err } from "../utils/error-response.js";
import {
	LoginBody as LoginBodySchema,
	LoginResponse,
} from "../utils/schemas.js";

// Strict per-route limit for auth endpoints (overrides the global limit).
const AUTH_RATE_LIMIT = {
	max: 10,
	timeWindow: "1 minute",
	onExceeded: (request: { ip: string }) =>
		auditLogin("rate_limited", request.ip),
};

// 自用模式:登入不再验密码。body 的 password 仅为向后兼容(被忽略)。
interface LoginBody {
	password?: string;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
	app.post<{ Body: LoginBody }>(
		"/api/v1/auth/login",
		{
			config: { rateLimit: AUTH_RATE_LIMIT },
			schema: {
				body: LoginBodySchema,
				response: {
					200: LoginResponse,
				},
			},
		},
		async (request, reply) => {
			// 自用模式(plan 2026-06-18-003):免密登入。只要 JWT_SECRET 已配置即签发
			// token,不再校验管理员口令。CORS + JWT_SECRET 仍是 fail-closed 启动前提,
			// 仍受 AUTH_RATE_LIMIT(10/min)限流。
			const secret = process.env.JWT_SECRET;
			if (!secret) {
				auditLogin("not_configured", request.ip);
				return err(reply, 500, "auth not configured");
			}

			auditLogin("success", request.ip);
			// Stable auditable subject so created_by reflects a real principal
			// instead of a hardcoded fallback (single-operator tool).
			const token = jwt.sign({ sub: "operator" }, secret, {
				expiresIn: "24h",
				algorithm: "HS256",
			});
			return { ok: true, token };
		},
	);

	app.get(
		"/api/v1/auth/status",
		{ config: { rateLimit: AUTH_RATE_LIMIT } },
		async (request, _reply) => {
			const authHeader = request.headers.authorization;
			if (!authHeader?.startsWith("Bearer ")) {
				return { ok: true, authenticated: false };
			}

			const secret = process.env.JWT_SECRET;
			if (!secret) {
				return { ok: true, authenticated: false };
			}

			const token = authHeader.slice(7);
			try {
				jwt.verify(token, secret, {
					algorithms: ["HS256"],
					clockTolerance: 30,
				});
				return { ok: true, authenticated: true };
			} catch {
				return { ok: true, authenticated: false };
			}
		},
	);
}
