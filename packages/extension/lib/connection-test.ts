import { listModels } from "./llm";

// listModels() 内部对 401/超时/连不上后端用的是这三条固定中文常量(我方控制,非后端透传)。
// 据此把结果映射为固定态;其余 ok:false(后端 !res.ok 透传,含 500 LLM/config 错误)
// 一律归 "llm-error",**不回显原始错误体**(防泄 endpoint/key)。
const UNAUTHORIZED_MSG = "登录已过期，请重新登录。";
const TIMEOUT_MSG = "拉取模型超时，请检查服务。";
const BACKEND_UNREACHABLE_MSG = "无法连接到后端服务，请确认后端已启动。";

export type ConnectionTestStatus =
	| "ok"
	| "unauthorized"
	| "timeout"
	| "backend-unreachable"
	| "llm-error";

export interface ConnectionTestResult {
	status: ConnectionTestStatus;
	/** 固定的人类可读文案(不含后端/LLM 原始错误体)。 */
	message: string;
	/** status==="ok" 时的模型数。 */
	modelCount?: number;
}

const FIXED_MESSAGE: Record<ConnectionTestStatus, string> = {
	ok: "连接正常。",
	unauthorized: "登录已过期,请重新登录。",
	timeout: "后端无响应(超时)。",
	"backend-unreachable": "后端不可达,请确认后端服务已启动(端口 3001)。",
	"llm-error": "后端可达,但 LLM/配置异常(检查后端 .env 的 endpoint/key)。",
};

/**
 * 测试连接:复用 listModels() 探针,把结果映射为固定态。
 * 注意:`listModels` 经后端代理(endpoint/key 在后端 env,扩展不直连 LLM)。
 * 慢但活着的 LLM 可能令探针超时而报 timeout——无独立「LLM 慢」态(已接受)。
 */
export async function testConnection(
	fetchFn?: typeof fetch,
): Promise<ConnectionTestResult> {
	const result = fetchFn
		? await listModels("", "", fetchFn)
		: await listModels("", "");

	if (result.ok) {
		const modelCount = result.models.length;
		if (modelCount === 0) {
			return { status: "llm-error", message: FIXED_MESSAGE["llm-error"] };
		}
		return {
			status: "ok",
			message: `${FIXED_MESSAGE.ok}(${modelCount} 个模型)`,
			modelCount,
		};
	}

	let status: ConnectionTestStatus;
	if (result.error === UNAUTHORIZED_MSG) status = "unauthorized";
	else if (result.error === TIMEOUT_MSG) status = "timeout";
	else if (result.error === BACKEND_UNREACHABLE_MSG)
		status = "backend-unreachable";
	else status = "llm-error"; // 后端 !res.ok 透传(含 500),不回显原始串

	return { status, message: FIXED_MESSAGE[status] };
}
