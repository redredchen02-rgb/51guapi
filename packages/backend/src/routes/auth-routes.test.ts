import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_ROUTES } from "../middleware/auth-middleware.js";
import { AUDIT_LOG_PATH } from "../services/audit-log.js";
import { registerAuthRoutes } from "./auth-routes.js";

const SECRET = randomBytes(48).toString("hex");
const PASSWORD = "super-secret-admin-pw";

function makeHash(pw: string): string {
	const salt = randomBytes(16);
	return `${salt.toString("hex")}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

function lastAuditLine(): Record<string, string> {
	const lines = readFileSync(AUDIT_LOG_PATH, "utf8").trim().split("\n");
	return JSON.parse(lines[lines.length - 1] ?? "{}");
}

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
	await registerAuthRoutes(app);
	await app.ready();
	return app;
}

describe("Auth Routes", () => {
	let app: FastifyInstance;
	const prevSecret = process.env.JWT_SECRET;
	const prevHash = process.env.JWT_ADMIN_PASSWORD_HASH;

	beforeEach(async () => {
		process.env.JWT_SECRET = SECRET;
		process.env.JWT_ADMIN_PASSWORD_HASH = makeHash(PASSWORD);
		app = await buildApp();
	});

	afterEach(async () => {
		await app.close();
		if (prevSecret === undefined) delete process.env.JWT_SECRET;
		else process.env.JWT_SECRET = prevSecret;
		if (prevHash === undefined) delete process.env.JWT_ADMIN_PASSWORD_HASH;
		else process.env.JWT_ADMIN_PASSWORD_HASH = prevHash;
	});

	describe("POST /api/v1/auth/login", () => {
		it("issues a 24h HS256 token for the correct password", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/auth/login",
				payload: { password: PASSWORD },
			});
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.ok).toBe(true);
			const decoded = jwt.verify(body.token, SECRET, {
				algorithms: ["HS256"],
			}) as jwt.JwtPayload;
			// exp - iat should be ~24h (86400s).
			expect((decoded.exp ?? 0) - (decoded.iat ?? 0)).toBe(86400);
			expect(lastAuditLine().result).toBe("success");
		});

		it("audits an invalid password attempt without logging the password", async () => {
			await app.inject({
				method: "POST",
				url: "/api/v1/auth/login",
				payload: { password: "definitely-wrong-secret-xyz" },
			});
			const raw = readFileSync(AUDIT_LOG_PATH, "utf8");
			expect(lastAuditLine().result).toBe("invalid_password");
			expect(raw).not.toContain("definitely-wrong-secret-xyz");
		});

		it("rate-limits after 10 attempts and audits the 429", async () => {
			let last = await app.inject({
				method: "POST",
				url: "/api/v1/auth/login",
				payload: { password: "x" },
			});
			for (let i = 0; i < 10; i++) {
				last = await app.inject({
					method: "POST",
					url: "/api/v1/auth/login",
					payload: { password: "x" },
				});
			}
			expect(last.statusCode).toBe(429);
			expect(lastAuditLine().result).toBe("rate_limited");
		});

		it("rejects a wrong password with 401", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/auth/login",
				payload: { password: "not-the-password" },
			});
			expect(res.statusCode).toBe(401);
			expect(res.json().ok).toBe(false);
		});

		it("returns 500 when admin hash is not configured", async () => {
			delete process.env.JWT_ADMIN_PASSWORD_HASH;
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/auth/login",
				payload: { password: PASSWORD },
			});
			expect(res.statusCode).toBe(500);
		});

		it("does not accept a token signed with a non-HS256 algorithm", async () => {
			// A token forged with "none" must not validate under our HS256 pin.
			const forged = jwt.sign({}, "", { algorithm: "none" });
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/auth/status",
				headers: { authorization: `Bearer ${forged}` },
			});
			expect(res.json().authenticated).toBe(false);
		});
	});

	describe("GET /api/v1/auth/status", () => {
		it("reports authenticated for a valid token", async () => {
			const token = jwt.sign({}, SECRET, {
				expiresIn: "24h",
				algorithm: "HS256",
			});
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/auth/status",
				headers: { authorization: `Bearer ${token}` },
			});
			expect(res.json()).toEqual({ ok: true, authenticated: true });
		});

		it("reports not authenticated for a garbage token", async () => {
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/auth/status",
				headers: { authorization: "Bearer garbage.token.here" },
			});
			expect(res.json().authenticated).toBe(false);
		});

		it("reports not authenticated with no auth header", async () => {
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/auth/status",
			});
			expect(res.json().authenticated).toBe(false);
		});
	});

	describe("PUBLIC_ROUTES", () => {
		it("no longer exposes /api/v1/models without auth", () => {
			expect(PUBLIC_ROUTES.has("/api/v1/models")).toBe(false);
		});

		it("keeps login and status public", () => {
			expect(PUBLIC_ROUTES.has("/api/v1/auth/login")).toBe(true);
			expect(PUBLIC_ROUTES.has("/api/v1/auth/status")).toBe(true);
		});
	});
});
