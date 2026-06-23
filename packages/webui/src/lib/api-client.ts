const DEFAULT_BACKEND = "http://localhost:3002";
const STORAGE_KEY = "guapi_backend_url";

// Detect same-origin prod deployment: when served from backend (not Vite dev server),
// use relative paths to avoid broken calls from non-localhost hosts.
function isDevMode(): boolean {
	try {
		return (
			window.location.hostname === "localhost" &&
			window.location.port === "5173"
		);
	} catch {
		return false;
	}
}

export function getBaseUrl(): string {
	if (!isDevMode()) {
		// In production (served from port 3002), use relative paths for same-origin requests.
		return "";
	}
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			// Validate: only allow localhost or 127.0.0.1 URLs
			const url = new URL(stored);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
				return stored.replace(/\/$/, "");
			}
			console.warn(
				"[api-client] Invalid backendUrl in localStorage (non-localhost), using default",
			);
		}
	} catch {
		// localStorage unavailable (SSR/test contexts) or invalid URL
	}
	return DEFAULT_BACKEND;
}

export function setBaseUrl(url: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, url);
	} catch {
		// ignore in environments without localStorage
	}
}

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export class NetworkError extends Error {
	constructor() {
		// Do not include URL in message to prevent leaking connection target
		super("Network error: backend unreachable");
		this.name = "NetworkError";
	}
}

const STATUS_CODES: Record<number, string> = {
	400: "BAD_REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	409: "CONFLICT",
	422: "UNPROCESSABLE",
	429: "RATE_LIMITED",
	500: "SERVER_ERROR",
	502: "BAD_GATEWAY",
	503: "SERVICE_UNAVAILABLE",
};

export async function apiFetch<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const base = getBaseUrl();
	const url = path.startsWith("http") ? path : `${base}${path}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...((init.headers as Record<string, string>) ?? {}),
	};

	let res: Response;
	try {
		res = await fetch(url, { ...init, headers });
	} catch {
		throw new NetworkError();
	}

	if (!res.ok) {
		const code = STATUS_CODES[res.status] ?? "UNKNOWN_ERROR";
		throw new ApiError(res.status, code, `Request failed: ${code}`);
	}

	return res.json() as Promise<T>;
}
