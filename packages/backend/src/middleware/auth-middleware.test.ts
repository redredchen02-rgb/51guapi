import { generateKeyPairSync, randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_ROUTES, requireAuth } from "./auth-middleware.js";

const SECRET = randomBytes(48).toString("hex");

// Builds a minimal app that wires requireAuth exactly the way app.ts does:
// a global preHandler that lets PUBLIC_ROUTES through and gates everything else.
async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	app.addHook("preHandler", async (request, reply) => {
		const url = request.url.split("?")[0];
		if (PUBLIC_ROUTES.has(url)) return;
		return requireAuth(request, reply);
	});
	// Protected route.
	app.get("/api/v1/protected", async (request) => ({
		ok: true,
		authenticated: request.user?.authenticated ?? false,
	}));
	// Public routes (mirrors the PUBLIC_ROUTES set; bodies are stand-ins).
	for (const route of PUBLIC_ROUTES) {
		app.all(route, async () => ({ ok: true, public: true }));
	}
	await app.ready();
	return app;
}

function validToken(): string {
	return jwt.sign({}, SECRET, { algorithm: "HS256", expiresIn: "1h" });
}

describe("auth-middleware requireAuth", () => {
	let app: FastifyInstance;
	const prevSecret = process.env.JWT_SECRET;

	beforeEach(async () => {
		process.env.JWT_SECRET = SECRET;
		app = await buildApp();
	});

	afterEach(async () => {
		await app.close();
		if (prevSecret === undefined) delete process.env.JWT_SECRET;
		else process.env.JWT_SECRET = prevSecret;
	});

	describe("happy path", () => {
		it("accepts a valid HS256 token on a protected route", async () => {
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
				headers: { authorization: `Bearer ${validToken()}` },
			});
			expect(res.statusCode).toBe(200);
			expect(res.json()).toEqual({ ok: true, authenticated: true });
		});
	});

	describe("deny by default", () => {
		it("rejects a protected route with no Authorization header (401)", async () => {
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
			});
			expect(res.statusCode).toBe(401);
		});

		it("rejects an Authorization header without the Bearer prefix (401)", async () => {
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
				headers: { authorization: validToken() },
			});
			expect(res.statusCode).toBe(401);
		});

		it("rejects Bearer + non-JWT garbage (401)", async () => {
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
				headers: { authorization: "Bearer not-a-real-token" },
			});
			expect(res.statusCode).toBe(401);
		});
	});

	describe("algorithm confusion", () => {
		it("rejects an alg:none forged token (401)", async () => {
			const forged = jwt.sign({}, "", { algorithm: "none" });
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
				headers: { authorization: `Bearer ${forged}` },
			});
			expect(res.statusCode).toBe(401);
		});

		it("rejects an RS256 token even when signed with a valid RSA key (HS pin)", async () => {
			// Classic alg-confusion: a token signed with a different algorithm
			// must not validate under our HS256-only pin.
			const { privateKey } = generateKeyPairSync("rsa", {
				modulusLength: 2048,
			});
			const forged = jwt.sign({}, privateKey, { algorithm: "RS256" });
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
				headers: { authorization: `Bearer ${forged}` },
			});
			expect(res.statusCode).toBe(401);
		});

		it("rejects a token signed with the wrong secret (401)", async () => {
			const forged = jwt.sign({}, "the-wrong-secret", {
				algorithm: "HS256",
			});
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
				headers: { authorization: `Bearer ${forged}` },
			});
			expect(res.statusCode).toBe(401);
		});
	});

	describe("expiry & clock tolerance", () => {
		it("accepts a token expired within the 30s clock tolerance", async () => {
			// Expired 10s ago — inside the 30s clockTolerance, so still valid.
			const token = jwt.sign(
				{ exp: Math.floor(Date.now() / 1000) - 10 },
				SECRET,
				{ algorithm: "HS256" },
			);
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
				headers: { authorization: `Bearer ${token}` },
			});
			expect(res.statusCode).toBe(200);
		});

		it("rejects a token expired beyond the 30s clock tolerance (401)", async () => {
			// Expired 60s ago — outside the 30s clockTolerance.
			const token = jwt.sign(
				{ exp: Math.floor(Date.now() / 1000) - 60 },
				SECRET,
				{ algorithm: "HS256" },
			);
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
				headers: { authorization: `Bearer ${token}` },
			});
			expect(res.statusCode).toBe(401);
		});
	});

	describe("PUBLIC_ROUTES", () => {
		it("allows login/status/healthz with no token", async () => {
			for (const route of [
				"/api/v1/auth/login",
				"/api/v1/auth/status",
				"/api/v1/healthz",
			]) {
				const res = await app.inject({ method: "GET", url: route });
				expect(res.statusCode).toBe(200);
				expect(res.json()).toEqual({ ok: true, public: true });
			}
		});

		it("treats public routes as exact paths: a trailing slash is NOT public", async () => {
			// "/api/v1/healthz/" is not in the Set, so it must fall through to
			// requireAuth and get denied. (Fastify has no route for it either,
			// but the auth gate fires in the preHandler before routing => 401.)
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/healthz/",
			});
			expect(res.statusCode).toBe(401);
		});

		it("treats public routes as exact paths: a query string does not break publicity", async () => {
			// Query string is stripped before the Set check, so this stays public.
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/healthz?foo=bar",
			});
			expect(res.statusCode).toBe(200);
		});

		it("normalizes a dot-segment path before the public-route check", async () => {
			// Fastify/light-my-request normalizes `..` segments, so the handler
			// sees request.url already collapsed: "/api/v1/foo/../auth/login"
			// becomes "/api/v1/auth/login" (a genuine public route) => 200.
			// (Verified empirically: req.url == "/api/v1/auth/login".)
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/foo/../auth/login",
			});
			expect(res.statusCode).toBe(200);
		});

		it("does not let a dot-segment reach a protected route unauthenticated", async () => {
			// Security invariant: a `..` that normalizes onto a PROTECTED route
			// must still require auth. "/api/v1/auth/login/../protected" collapses
			// to "/api/v1/protected" (not public) => 401, no traversal bypass.
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/auth/login/../protected",
			});
			expect(res.statusCode).toBe(401);
		});
	});

	describe("misconfiguration", () => {
		it("returns 500 'auth not configured' when JWT_SECRET is missing", async () => {
			delete process.env.JWT_SECRET;
			const res = await app.inject({
				method: "GET",
				url: "/api/v1/protected",
				headers: { authorization: `Bearer ${validToken()}` },
			});
			expect(res.statusCode).toBe(500);
			expect(res.json().error).toContain("auth not configured");
		});
	});
});
