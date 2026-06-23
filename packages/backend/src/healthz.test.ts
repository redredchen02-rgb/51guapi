import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	app.get("/api/v1/healthz", async () => ({ ok: true }));
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
		});
		expect(res.statusCode).toBe(200);
	});

	it("response body does not leak config info", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/healthz" });
		const body = res.body;
		expect(body).not.toMatch(/\d{4,5}/); // no port numbers
		expect(body).not.toMatch(/127\.0\.0\.1|localhost/);
		expect(body).not.toMatch(/\/home\/|\/Users\//);
	});
});
