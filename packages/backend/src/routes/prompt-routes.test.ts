import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initPendingDb } from "../scraper/pending-db.js";
import { registerPromptRoutes } from "./prompt-routes.js";

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	await registerPromptRoutes(app);
	await app.ready();
	return app;
}

// 数据已迁入 SQLite(migration 012);经清表实现跨测试隔离。
function cleanPrompts() {
	initPendingDb();
	getDb().exec("DELETE FROM prompt_templates");
}

describe("prompt-routes", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		cleanPrompts();
		app = await buildApp();
	});

	afterEach(async () => {
		await app.close();
		cleanPrompts();
	});

	// ---- GET /api/v1/prompts ----

	it("GET /api/v1/prompts：初始返回空陣列", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/prompts" });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(Array.isArray(body.prompts)).toBe(true);
	});

	// ---- POST /api/v1/prompts ----

	it("POST /api/v1/prompts：有效 body → 200 + 返回含 id 的 prompt", async () => {
		const pairs = [{ input: "Q1", output: "A1" }];
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: {
				name: "測試模板",
				template: "請依據以下資訊生成文章：{{facts}}",
				fewShotPairs: pairs,
			},
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.prompt.id).toBeDefined();
		expect(body.prompt.name).toBe("測試模板");
		expect(body.prompt.fewShotPairs).toEqual(pairs);
	});

	it("POST /api/v1/prompts：傳舊格式 fewShotExamples → 200，但回傳 fewShotPairs（舊欄位被忽略）", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: {
				name: "測試模板",
				template: "template",
				fewShotExamples: "Q\n---\nA",
			},
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.prompt.fewShotPairs).toEqual([]);
		expect(body.prompt).not.toHaveProperty("fewShotExamples");
	});

	it("POST /api/v1/prompts：缺必填欄位 name → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { template: "some template" },
		});
		expect(res.statusCode).toBe(400);
	});

	it("POST /api/v1/prompts：缺必填欄位 template → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { name: "模板名稱" },
		});
		expect(res.statusCode).toBe(400);
	});

	// ---- GET /api/v1/prompts/:id ----

	it("GET /api/v1/prompts/:id：已存在 id → 200 + 返回 prompt", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { name: "模板A", template: "template body" },
		});
		const { prompt } = createRes.json();

		const res = await app.inject({
			method: "GET",
			url: `/api/v1/prompts/${prompt.id}`,
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().prompt.name).toBe("模板A");
	});

	it("GET /api/v1/prompts/:id：不存在 id → 404", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/prompts/prompt_nonexistent_0000",
		});
		expect(res.statusCode).toBe(404);
	});

	// ---- PUT /api/v1/prompts/:id ----

	it("PUT /api/v1/prompts/:id：更新 name + template → 200 + 返回更新後 prompt", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { name: "舊模板", template: "old template" },
		});
		const { prompt } = createRes.json();

		const res = await app.inject({
			method: "PUT",
			url: `/api/v1/prompts/${prompt.id}`,
			payload: { name: "新模板", template: "new template" },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.prompt.name).toBe("新模板");
		expect(body.prompt.template).toBe("new template");
		expect(body.prompt.id).toBe(prompt.id);
	});

	it("PUT /api/v1/prompts/:id：不存在 id → 404", async () => {
		const res = await app.inject({
			method: "PUT",
			url: "/api/v1/prompts/prompt_nonexistent_0000",
			payload: { name: "更新名稱" },
		});
		expect(res.statusCode).toBe(404);
	});

	it("PUT /api/v1/prompts/:id：空 body（無必填）→ 200（UpdateBody 全為 optional）", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { name: "模板B", template: "template" },
		});
		const { prompt } = createRes.json();

		const res = await app.inject({
			method: "PUT",
			url: `/api/v1/prompts/${prompt.id}`,
			payload: {},
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().prompt.name).toBe("模板B");
	});

	// ---- DELETE /api/v1/prompts/:id ----

	it("DELETE /api/v1/prompts/:id：成功刪除 → 200 + ok:true", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { name: "待刪除", template: "template" },
		});
		const { prompt } = createRes.json();

		const delRes = await app.inject({
			method: "DELETE",
			url: `/api/v1/prompts/${prompt.id}`,
		});
		expect(delRes.statusCode).toBe(200);
		expect(delRes.json().ok).toBe(true);

		// 刪除後再 GET → 404
		const getRes = await app.inject({
			method: "GET",
			url: `/api/v1/prompts/${prompt.id}`,
		});
		expect(getRes.statusCode).toBe(404);
	});

	it("DELETE /api/v1/prompts/:id：不存在 id → 404", async () => {
		const res = await app.inject({
			method: "DELETE",
			url: "/api/v1/prompts/prompt_nonexistent_0000",
		});
		expect(res.statusCode).toBe(404);
	});

	// ---- Integration: list reflects mutations ----

	it("Integration: POST → GET list → 清單包含新建 prompt", async () => {
		await app.inject({
			method: "POST",
			url: "/api/v1/prompts",
			payload: { name: "整合測試模板", template: "content" },
		});
		const listRes = await app.inject({
			method: "GET",
			url: "/api/v1/prompts",
		});
		const prompts = listRes.json().prompts as { name: string }[];
		expect(prompts.some((p) => p.name === "整合測試模板")).toBe(true);
	});
});

