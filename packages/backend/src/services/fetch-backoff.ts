import type { GossipFactsBlock, Settings } from "@51guapi/shared";

export interface LlmDeps {
	settings: Settings;
	apiKey: string;
	facts?: GossipFactsBlock;
	fetchFn?: typeof fetch;
	now?: () => string;
	genId?: () => string;
	timeoutMs?: number;
	/** 429/5xx 退避重试参数(可注入便于测试快进)。 */
	maxRetries?: number;
	retryBaseMs?: number;
	/** 单次退避时长上限(亦作总等待的近似上限,防上游 Retry-After 拉爆)。 */
	retryCapMs?: number;
	sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_CAP_MS = 8_000;

export const defaultSleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms));

/** 解析 Retry-After(秒或 HTTP-date),失败返 null。 */
export function parseRetryAfter(res: Response, nowMs: number): number | null {
	const h = res.headers?.get?.("retry-after");
	if (!h) return null;
	const secs = Number(h);
	if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
	const date = Date.parse(h);
	if (Number.isFinite(date)) return Math.max(0, date - nowMs);
	return null;
}

/**
 * 单请求 fetch + **仅对 429/5xx** 的有限次指数退避重试。
 * 每次尝试各自 AbortController+timer(勿共享,否则重试请求会被旧 signal 立即 abort)。
 * 非 429/5xx(含 ok、4xx 如 400)与网络错误立即返回交调用方处理(保持分桶)。
 */
export async function fetchWithBackoff(
	fetchFn: typeof fetch,
	url: string,
	init: RequestInit,
	timeoutMs: number,
	deps: LlmDeps,
): Promise<{ res?: Response; fetchErr?: unknown }> {
	const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
	const baseMs = deps.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
	const capMs = deps.retryCapMs ?? DEFAULT_RETRY_CAP_MS;
	const sleep = deps.sleep ?? defaultSleep;

	for (let attempt = 0; ; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let res: Response | undefined;
		let fetchErr: unknown = null;
		try {
			res = await fetchFn(url, { ...init, signal: controller.signal });
		} catch (err) {
			fetchErr = err;
		} finally {
			clearTimeout(timer);
		}
		if (fetchErr) return { fetchErr };
		if (!res) return {};
		const retryable = res.status === 429 || res.status >= 500;
		if (!retryable || attempt >= maxRetries) return { res };
		// 退避:Retry-After(若有,clamp 到 capMs)否则指数,均 clamp 到 capMs。
		const retryAfter = parseRetryAfter(res, Date.now());
		const expo = Math.min(capMs, baseMs * 2 ** attempt);
		const delay = Math.min(capMs, retryAfter ?? expo);
		// 日志只记 status/attempt/delay,不记 body/headers/url/key。
		console.warn(
			`[llm] retry status=${res.status} attempt=${attempt + 1} delay=${delay}ms`,
		);
		await sleep(delay);
	}
}
