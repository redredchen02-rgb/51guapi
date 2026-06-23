import { fetchWithTimeout } from "@51guapi/shared";
import { getBackendUrl } from "./backend-url";

// 统一的后端请求封装:getBackendUrl() → fetchWithTimeout → 交回原始 Response。
// 无鉴权头(JWT 已移除),无 401 副作用。

export interface ApiFetchInit extends Omit<RequestInit, "headers"> {
	/** 额外请求头,与默认 Content-Type 合并。 */
	headers?: Record<string, string>;
	/** fetchWithTimeout 超时,默认 10s。fetchFn 注入时忽略。 */
	timeoutMs?: number;
	/** 测试注入的 fetch;给定时绕过 fetchWithTimeout(不计超时)。 */
	fetchFn?: typeof fetch;
}

/**
 * 向后端发起请求。`path` 以 `/` 开头(自动前缀 backendUrl),或传完整 URL。
 */
export async function apiFetch(
	path: string,
	init: ApiFetchInit = {},
): Promise<Response> {
	const { headers: extraHeaders, timeoutMs = 10_000, fetchFn, ...rest } = init;

	const backendUrl = await getBackendUrl();
	const url = path.startsWith("http") ? path : `${backendUrl}${path}`;
	const headers = { "Content-Type": "application/json", ...extraHeaders };

	return fetchFn
		? fetchFn(url, { ...rest, headers })
		: fetchWithTimeout(url, { ...rest, headers, timeoutMs });
}
