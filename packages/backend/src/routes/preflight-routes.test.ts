import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPreflightRoutes } from "./preflight-routes.js";

const GOOD_CORS = "chrome-extension://iljimdgfajpgnmanklehhmapojbcjecd";

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	await registerPreflightRoutes(app);
	await app.ready();
	return app;
}

describe("GET /api/v1/preflight", () => {
	let app: FastifyInstance;
	const saved = { ...process.env };

	beforeEach(async () => {
		process.env.CORS_ORIGIN = GOOD_CORS;
		app = await buildApp();
	});

	afterEach(async () => {
		await app.close();
		process.env.CORS_ORIGIN = saved.CORS_ORIGIN;
	});

	it("happy:子集全 pass + residuals 列出", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/preflight",
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
		expect(Array.isArray(body.residuals)).toBe(true);
		expect(body.residuals.length).toBeGreaterThan(0);
	});

	it("error:CORS_ORIGIN=* → 该项 fail,且不泄露其它敏感值", async () => {
		process.env.CORS_ORIGIN = "*";
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/preflight",
		});
		const body = res.json();
		const cors = body.checks.find(
			(c: { id: string }) => c.id === "cors-origin-configured",
		);
		expect(cors.pass).toBe(false);
		const failclosed = body.checks.find(
			(c: { id: string }) => c.id === "env-failclosed",
		);
		expect(failclosed.pass).toBe(false);
	});

	it("security:响应字段白名单不含任何明文配置值", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/preflight",
		});
		const raw = res.body;
		expect(raw).not.toContain(GOOD_CORS);
		// 只允许的顶层字段。
		const body = res.json();
		expect(Object.keys(body).sort()).toEqual(["checks", "ok", "residuals"]);
		for (const c of body.checks) {
			expect(Object.keys(c).sort()).toEqual(["id", "label", "pass"]);
		}
	});
});
