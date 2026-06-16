/**
 * 共享测试工具:模拟 fetch 并捕获请求 URL/init,以及从 init 提取 Authorization 头。
 * 由 config-client / prompt-client / gossip-client 的测试复用。
 */

export interface MockResult {
	capturedUrls: string[];
	capturedInits: (RequestInit | undefined)[];
	fn: typeof fetch;
}

/**
 * 返回一个记录每次调用 URL 与 init 的假 fetch,响应体为 JSON.stringify(body)。
 */
export function mockFetch(body: unknown, status = 200): MockResult {
	const capturedUrls: string[] = [];
	const capturedInits: (RequestInit | undefined)[] = [];
	const fn = async (url: string | URL | Request, init?: RequestInit) => {
		capturedUrls.push(String(url));
		capturedInits.push(init);
		return new Response(JSON.stringify(body), { status });
	};
	return { capturedUrls, capturedInits, fn: fn as unknown as typeof fetch };
}

/**
 * 从 RequestInit 中提取 Authorization 头(Bearer token)。
 */
export function authHeader(init: RequestInit | undefined): string | undefined {
	const h = init?.headers as Record<string, string> | undefined;
	return h?.Authorization;
}
