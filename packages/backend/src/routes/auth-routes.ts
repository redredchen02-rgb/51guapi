import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { auditLogin } from "../services/audit-log.js";
import { verifyPassword } from "../services/password.js";
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

interface LoginBody {
	password: string;
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
			const adminHash = process.env.JWT_ADMIN_PASSWORD_HASH;
			const secret = process.env.JWT_SECRET;
			if (!adminHash || !secret) {
				auditLogin("not_configured", request.ip);
				return err(reply, 500, "auth not configured");
			}

			const { password } = request.body;
			if (!verifyPassword(password, adminHash)) {
				auditLogin("invalid_password", request.ip);
				return err(reply, 401, "invalid password");
			}

			auditLogin("success", request.ip);
			const token = jwt.sign({}, secret, {
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
