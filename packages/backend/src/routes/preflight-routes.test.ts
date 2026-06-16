import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_ROUTES, requireAuth } from "../middleware/auth-middleware.js";
import { registerPreflightRoutes } from "./preflight-routes.js";

const SECRET = randomBytes(48).toString("hex");
const VALID_HASH = `${"a".repeat(32)}:${"b".repeat(128)}`;
const GOOD_CORS = "chrome-extension://iljimdgfajpgnmanklehhmapojbcjecd";

// 完整镜像 app.ts 的接线:全局 preHandler 放行 PUBLIC_ROUTES,其余需 JWT;
// preflight 路由注册在 hook 之后 → 必须需 token。
async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	app.addHook("preHandler", async (request, reply) => {
		const url = request.url.split("?")[0];
		if (PUBLIC_ROUTES.has(url)) return;
		return requireAuth(request, reply);
	});
	await registerPreflightRoutes(app);
	await app.ready();
	return app;
}

function token(): string {
	return jwt.sign({}, SECRET, { algorithm: "HS256", expiresIn: "1h" });
}

function auth() {
	return { authorization: `Bearer ${token()}` };
}

describe("GET /api/v1/preflight", () => {
	let app: FastifyInstance;
	const saved = { ...process.env };

	beforeEach(async () => {
		process.env.JWT_SECRET = SECRET;
		process.env.JWT_ADMIN_PASSWORD_HASH = VALID_HASH;
		process.env.CORS_ORIGIN = GOOD_CORS;
		app = await buildApp();
	});

	afterEach(async () => {
		await app.close();
		process.env.JWT_SECRET = saved.JWT_SECRET;
		process.env.JWT_ADMIN_PASSWORD_HASH = saved.JWT_ADMIN_PASSWORD_HASH;
		process.env.CORS_ORIGIN = saved.CORS_ORIGIN;
	});

	it("security:无 token → 401(证明注册顺序正确,不在 PUBLIC_ROUTES)", async () => {
		expect(PUBLIC_ROUTES.has("/api/v1/preflight")).toBe(false);
		const res = await app.inject({ method: "GET", url: "/api/v1/preflight" });
		expect(res.statusCode).toBe(401);
	});

	it("happy:子集全 pass + residuals 列出", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/preflight",
			headers: auth(),
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
			headers: auth(),
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

	it("security:响应字段白名单不含任何明文密钥", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/preflight",
			headers: auth(),
		});
		const raw = res.body;
		// 绝不出现任何敏感值明文。
		expect(raw).not.toContain(SECRET);
		expect(raw).not.toContain(VALID_HASH);
		expect(raw).not.toContain(GOOD_CORS);
		expect(raw).not.toMatch(/JWT_SECRET\s*[:=]\s*[a-f0-9]{32,}/);
		// 只允许的顶层字段。
		const body = res.json();
		expect(Object.keys(body).sort()).toEqual(["checks", "ok", "residuals"]);
		for (const c of body.checks) {
			expect(Object.keys(c).sort()).toEqual(["id", "label", "pass"]);
		}
	});
});
