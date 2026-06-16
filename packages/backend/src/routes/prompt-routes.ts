import type { FastifyInstance } from "fastify";
import {
	deletePrompt,
	getAllPrompts,
	getPromptById,
	type PromptTemplate,
	type PromptTemplateCreate,
	type PromptTemplateUpdate,
	savePrompt,
} from "../scraper/prompt-store.js";
import { err } from "../utils/error-response.js";
import { generateId } from "../utils/generate-id.js";
import {
	CreatePromptBody as CreatePromptBodySchema,
	UpdatePromptBody as UpdatePromptBodySchema,
} from "../utils/schemas.js";

/**
 * Prompt 模板管理 API。
 *
 * GET    /api/v1/prompts         — 列出所有模板
 * POST   /api/v1/prompts         — 创建新模板
 * GET    /api/v1/prompts/:id     — 获取单个模板
 * PUT    /api/v1/prompts/:id     — 更新模板
 * DELETE /api/v1/prompts/:id     — 删除模板
 *
 * 设计原则:
 *   1. 模板以 JSON 文件存储在 data/prompts/ 目录下
 *   2. ID 格式: prompt_{timestamp}_{random}
 *   3. 所有路由受全局 JWT 中间件保护
 */

interface PromptIdParams {
	id: string;
}

export async function registerPromptRoutes(
	app: FastifyInstance,
): Promise<void> {
	// 列出所有模板
	app.get("/api/v1/prompts", async () => {
		const prompts = await getAllPrompts();
		return { ok: true, prompts };
	});

	// 创建新模板
	app.post<{ Body: PromptTemplateCreate }>(
		"/api/v1/prompts",
		{
			schema: {
				body: CreatePromptBodySchema,
			},
		},
		async (request, _reply) => {
			const { name, template, fewShotPairs, model } = request.body;

			const now = new Date().toISOString();
			const id = generateId("prompt");
			const prompt: PromptTemplate = {
				id,
				name,
				template,
				fewShotPairs: fewShotPairs ?? [],
				...(model ? { model } : {}),
				createdAt: now,
				updatedAt: now,
			};

			await savePrompt(prompt);
			return { ok: true, prompt };
		},
	);

	// 获取单个模板
	app.get<{ Params: PromptIdParams }>(
		"/api/v1/prompts/:id",
		async (request, reply) => {
			const prompt = await getPromptById(request.params.id);
			if (!prompt) return err(reply, 404, "Prompt not found");
			return { ok: true, prompt };
		},
	);

	// 更新模板
	app.put<{ Params: PromptIdParams; Body: PromptTemplateUpdate }>(
		"/api/v1/prompts/:id",
		{
			schema: {
				body: UpdatePromptBodySchema,
			},
		},
		async (request, reply) => {
			const { id } = request.params;
			const existing = await getPromptById(id);
			if (!existing) return err(reply, 404, "Prompt not found");

			const body = request.body;
			const updated: PromptTemplate = {
				...existing,
				...(body.name !== undefined ? { name: body.name } : {}),
				...(body.template !== undefined ? { template: body.template } : {}),
				...(body.fewShotPairs !== undefined
					? { fewShotPairs: body.fewShotPairs }
					: {}),
				...(body.model !== undefined ? { model: body.model } : {}),
				updatedAt: new Date().toISOString(),
			};

			await savePrompt(updated);
			return { ok: true, prompt: updated };
		},
	);

	// 删除模板
	app.delete<{ Params: PromptIdParams }>(
		"/api/v1/prompts/:id",
		async (request, reply) => {
			const prompt = await getPromptById(request.params.id);
			if (!prompt) return err(reply, 404, "Prompt not found");
			await deletePrompt(request.params.id);
			return { ok: true };
		},
	);
}
