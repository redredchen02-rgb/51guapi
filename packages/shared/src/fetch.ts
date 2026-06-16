export interface FetchWithTimeoutOptions extends RequestInit {
	timeoutMs?: number;
}

export async function fetchWithTimeout(
	input: string | URL | Request,
	options?: FetchWithTimeoutOptions,
): Promise<Response> {
	const { timeoutMs = 10_000, ...fetchOptions } = options ?? {};
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetch(input, { ...fetchOptions, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}
