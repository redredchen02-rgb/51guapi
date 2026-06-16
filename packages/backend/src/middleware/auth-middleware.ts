import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { err } from "../utils/error-response.js";

declare module "fastify" {
	interface FastifyRequest {
		user?: { authenticated: boolean };
	}
}

// Unauthenticated routes. /api/v1/models was removed: it triggers a paid LLM
// call, and the extension already sends a token for it. /auth/status stays
// public (it is the auth-state probe itself) but carries a strict rate limit.
export const PUBLIC_ROUTES = new Set([
	"/api/v1/auth/login",
	"/api/v1/auth/status",
	"/api/v1/healthz",
]);

export async function requireAuth(
	request: FastifyRequest,
	reply: FastifyReply,
): Promise<void> {
	const authHeader = request.headers.authorization;
	if (!authHeader?.startsWith("Bearer ")) {
		return err(reply, 401, "unauthorized");
	}

	const token = authHeader.slice(7);
	const secret = process.env.JWT_SECRET;

	if (!secret) {
		return err(reply, 500, "auth not configured");
	}

	try {
		jwt.verify(token, secret, { algorithms: ["HS256"], clockTolerance: 30 });
		request.user = { authenticated: true };
	} catch {
		return err(reply, 401, "unauthorized");
	}
}
