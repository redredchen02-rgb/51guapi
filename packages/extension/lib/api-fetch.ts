import { fetchWithTimeout } from "@51guapi/shared";
import { clearToken, getAuthHeaders } from "./auth-client";
import { getBackendUrl } from "./backend-url";

// 统一的后端请求封装,消除散落在各 client 的重复样板:
//   getAuthHeaders() → getBackendUrl() → fetchWithTimeout → 401 时 clearToken。
//
// 边界(刻意保留 fail-closed 双写):apiFetch 只做「注入鉴权头 + 解析 backendUrl +
// 401 副作用清 token」,然后把原始 Response 交回。它**不**吞网络错误、不替调用方
// 决定 fallback ——每个 client 仍保留自己的 try/catch 与回退值(本地存储 PRIMARY,
// 后端 SECONDARY),这样后端不可达时扩展继续本地工作。
//
// 不纳入此封装的两个 client(语义不兼容):
//   - auth-client.login:认证引导,无 token、无 401→clearToken。
//   - published-posts-client:getSettings().backendUrl(无 fallback)+ localhost-only
//     正则约束 + best-effort 静默吞错,与「错误向上可见」冲突。

export interface ApiFetchInit extends Omit<RequestInit, "headers"> {
	/** 额外请求头,与鉴权头合并(同名覆盖鉴权头之外的字段)。 */
	headers?: Record<string, string>;
	/** fetchWithTimeout 超时,默认 10s。fetchFn 注入时忽略。 */
	timeoutMs?: number;
	/** 测试注入的 fetch;给定时绕过 fetchWithTimeout(不计超时)。 */
	fetchFn?: typeof fetch;
}

/**
 * 向后端发起带鉴权的请求。`path` 以 `/` 开头(自动前缀 backendUrl),或传完整 URL。
 * 401 时清除本地 token 并返回原始 Response(由调用方决定回退)。
 */
export async function apiFetch(
	path: string,
	init: ApiFetchInit = {},
): Promise<Response> {
	const { headers: extraHeaders, timeoutMs = 10_000, fetchFn, ...rest } = init;

	const auth = await getAuthHeaders();
	const backendUrl = await getBackendUrl();
	const url = path.startsWith("http") ? path : `${backendUrl}${path}`;
	const headers = { ...auth, ...extraHeaders };

	const res = fetchFn
		? await fetchFn(url, { ...rest, headers })
		: await fetchWithTimeout(url, { ...rest, headers, timeoutMs });

	if (res.status === 401) {
		await clearToken();
	}
	return res;
}
