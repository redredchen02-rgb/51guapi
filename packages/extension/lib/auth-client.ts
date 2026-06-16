import { storage } from "#imports";
import { getBackendUrl } from "./backend-url";

const AUTH_TOKEN_KEY = "local:authToken";

export interface LoginResult {
	ok: boolean;
	token?: string;
	error?: string;
}

export async function login(password: string): Promise<LoginResult> {
	try {
		const backendUrl = await getBackendUrl();
		const res = await fetch(`${backendUrl}/api/v1/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password }),
		});

		if (!res.ok) {
			const data = (await res.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			return {
				ok: false,
				error: (data.error as string) ?? `登录失败 (${res.status})`,
			};
		}

		const data = (await res.json()) as LoginResult;
		if (data.ok && data.token) {
			await setToken(data.token);
			return { ok: true, token: data.token };
		}

		return { ok: false, error: "服务器返回无效数据" };
	} catch {
		return { ok: false, error: "无法连接到后端服务，请确认后端已启动。" };
	}
}

export async function getToken(): Promise<string | null> {
	return (await storage.getItem<string>(AUTH_TOKEN_KEY)) ?? null;
}

export async function setToken(token: string): Promise<void> {
	await storage.setItem(AUTH_TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
	await storage.removeItem(AUTH_TOKEN_KEY);
}

export async function isAuthenticated(): Promise<boolean> {
	return (await getToken()) !== null;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
	const token = await getToken();
	return {
		"Content-Type": "application/json",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
}
