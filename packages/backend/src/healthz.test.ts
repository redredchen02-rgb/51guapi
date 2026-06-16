import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_ROUTES, requireAuth } from "./middleware/auth-middleware.js";

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	app.get("/api/v1/healthz", async () => ({ ok: true }));
	app.addHook("preHandler", async (request, reply) => {
		const url = request.url.split("?")[0];
		if (PUBLIC_ROUTES.has(url)) return;
		return requireAuth(request, reply);
	});
	await app.ready();
	return app;
}

describe("GET /api/v1/healthz", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		app = await buildApp();
	});

	afterEach(async () => {
		await app.close();
	});

	it("returns {ok:true} with status 200", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/healthz" });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ ok: true });
	});

	it("does not require Authorization header (returns 200, not 401)", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/healthz",
			// deliberately no Authorization header
		});
		expect(res.statusCode).toBe(200);
	});

	it("is listed in PUBLIC_ROUTES", () => {
		expect(PUBLIC_ROUTES.has("/api/v1/healthz")).toBe(true);
	});

	it("response body does not leak config info", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/healthz" });
		const body = res.body;
		// Must not contain PORT, HOST, or filesystem paths
		expect(body).not.toMatch(/\d{4,5}/); // no port numbers
		expect(body).not.toMatch(/127\.0\.0\.1|localhost/);
		expect(body).not.toMatch(/\/home\/|\/Users\//);
	});
});
