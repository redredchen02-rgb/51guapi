import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getLlmConfig,
	resolveLlmConfig,
	validateLlmConfig,
} from "./llm-config.js";

// 保存/还原 LLM_* 环境变量，避免污染其它测试
const SAVED = {
	key: process.env.LLM_API_KEY,
	endpoint: process.env.LLM_ENDPOINT,
	model: process.env.LLM_MODEL,
};

beforeEach(() => {
	delete process.env.LLM_API_KEY;
	delete process.env.LLM_ENDPOINT;
	delete process.env.LLM_MODEL;
});

afterEach(() => {
	for (const [k, v] of [
		["LLM_API_KEY", SAVED.key],
		["LLM_ENDPOINT", SAVED.endpoint],
		["LLM_MODEL", SAVED.model],
	] as const) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe("getLlmConfig", () => {
	it("从环境变量读取 apiKey/endpoint/model", () => {
		process.env.LLM_API_KEY = "sk-test";
		process.env.LLM_ENDPOINT = "https://llm.example.com/v1";
		process.env.LLM_MODEL = "gemma";
		const cfg = getLlmConfig();
		expect(cfg.apiKey).toBe("sk-test");
		expect(cfg.endpoint).toBe("https://llm.example.com/v1");
		expect(cfg.model).toBe("gemma");
	});

	it("缺 key/endpoint → 返回空字符串", () => {
		const cfg = getLlmConfig();
		expect(cfg.apiKey).toBe("");
		expect(cfg.endpoint).toBe("");
	});

	it("无 LLM_MODEL 且无 settings → 回落默认 gpt-4o-mini", () => {
		expect(getLlmConfig().model).toBe("gpt-4o-mini");
	});

	it("无 LLM_MODEL 时用 settings.model", () => {
		expect(getLlmConfig({ model: "custom-model" }).model).toBe("custom-model");
	});

	it("LLM_MODEL 优先于 settings.model", () => {
		process.env.LLM_MODEL = "env-model";
		expect(getLlmConfig({ model: "settings-model" }).model).toBe("env-model");
	});

	it("model 两侧空白被 trim", () => {
		process.env.LLM_MODEL = "  spaced-model  ";
		expect(getLlmConfig().model).toBe("spaced-model");
	});
});

describe("validateLlmConfig", () => {
	it("缺 apiKey → invalid，错误提示 LLM_API_KEY", () => {
		const v = validateLlmConfig({ apiKey: "", endpoint: "e", model: "m" });
		expect(v.valid).toBe(false);
		expect(v.error).toMatch(/LLM_API_KEY/);
	});

	it("缺 endpoint → invalid，错误提示 LLM_ENDPOINT", () => {
		const v = validateLlmConfig({ apiKey: "k", endpoint: "", model: "m" });
		expect(v.valid).toBe(false);
		expect(v.error).toMatch(/LLM_ENDPOINT/);
	});

	it("key+endpoint 齐全 → valid，无 error", () => {
		const v = validateLlmConfig({ apiKey: "k", endpoint: "e", model: "m" });
		expect(v.valid).toBe(true);
		expect(v.error).toBeUndefined();
	});
});

describe("resolveLlmConfig", () => {
	it("配置无效 → 返回 null", () => {
		expect(resolveLlmConfig()).toBeNull();
	});

	it("配置有效 → 返回完整 config", () => {
		process.env.LLM_API_KEY = "k";
		process.env.LLM_ENDPOINT = "https://e";
		process.env.LLM_MODEL = "m";
		expect(resolveLlmConfig()).toEqual({
			apiKey: "k",
			endpoint: "https://e",
			model: "m",
		});
	});

	it("仅缺 endpoint → null", () => {
		process.env.LLM_API_KEY = "k";
		expect(resolveLlmConfig()).toBeNull();
	});
});
