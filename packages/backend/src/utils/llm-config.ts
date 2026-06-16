/**
 * LLM 配置工具函数
 * 统一管理 LLM API key、endpoint、model 的读取和验证
 */

export interface LlmConfig {
	apiKey: string;
	endpoint: string;
	model: string;
}

export interface LlmConfigValidation {
	valid: boolean;
	error?: string;
}

/**
 * 从环境变量读取 LLM 配置
 */
export function getLlmConfig(settings?: { model?: string }): LlmConfig {
	return {
		apiKey: process.env.LLM_API_KEY || "",
		endpoint: process.env.LLM_ENDPOINT || "",
		model: (process.env.LLM_MODEL || settings?.model || "gpt-4o-mini").trim(),
	};
}

/**
 * 验证 LLM 配置是否完整
 */
export function validateLlmConfig(config: LlmConfig): LlmConfigValidation {
	if (!config.apiKey) {
		return {
			valid: false,
			error:
				"Backend is not configured with an LLM_API_KEY. Please check .env file.",
		};
	}
	if (!config.endpoint) {
		return {
			valid: false,
			error:
				"Backend is not configured with an LLM_ENDPOINT. Please check .env file.",
		};
	}
	return { valid: true };
}

/**
 * 解析 LLM 配置（读取 + 验证）
 * 返回 null 表示配置无效，错误信息已记录
 */
export function resolveLlmConfig(settings?: {
	model?: string;
}): LlmConfig | null {
	const config = getLlmConfig(settings);
	const validation = validateLlmConfig(config);
	if (!validation.valid) {
		return null;
	}
	return config;
}
