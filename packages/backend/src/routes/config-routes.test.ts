import { DEFAULT_FIELD_MAPPING } from "@51guapi/shared";
import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { initPendingDb } from "../scraper/pending-db.js";
import { configDelete } from "../services/config-store.js";
import { registerConfigRoutes } from "./config-routes.js";

async function buildApp() {
	initPendingDb();
	const app = Fastify();
	await registerConfigRoutes(app);
	await app.ready();
	return app;
}

beforeEach(() => {
	// 清理 config_store 确保每次测试从干净状态开始
	initPendingDb();
	configDelete("field_mappings");
});

describe("GET /api/v1/config/mappings", () => {
	it("returns default field mapping", async () => {
		const app = await buildApp();
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/config/mappings",
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.mappings).toBeDefined();
		expect(body.mappings.title.selector).toBe(
			DEFAULT_FIELD_MAPPING.title?.selector,
		);
		expect(body.mappings.body.fieldType).toBe("quill");
		expect(body.version).toBeTypeOf("number");
		await app.close();
	});
});

describe("PUT /api/v1/config/mappings", () => {
	it("updates mappings with valid payload", async () => {
		const app = await buildApp();
		const newMappings = {
			title: {
				selector: "input#new-title",
				fieldType: "text",
				label: "新標題",
			},
		};
		const res = await app.inject({
			method: "PUT",
			url: "/api/v1/config/mappings",
			payload: { mappings: newMappings },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.mappings.title.selector).toBe("input#new-title");

		// 验证 GET 也返回更新后的映射
		const getRes = await app.inject({
			method: "GET",
			url: "/api/v1/config/mappings",
		});
		expect(getRes.json().mappings.title.selector).toBe("input#new-title");
		await app.close();
	});

	it("rejects invalid payload (missing selector)", async () => {
		const app = await buildApp();
		const res = await app.inject({
			method: "PUT",
			url: "/api/v1/config/mappings",
			payload: { mappings: { title: { fieldType: "text" } } }, // 缺 selector
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().ok).toBe(false);
		await app.close();
	});

	it("rejects invalid payload (bad fieldType)", async () => {
		const app = await buildApp();
		const res = await app.inject({
			method: "PUT",
			url: "/api/v1/config/mappings",
			payload: {
				mappings: { title: { selector: "#t", fieldType: "bogus" } },
			},
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().ok).toBe(false);
		await app.close();
	});
});
