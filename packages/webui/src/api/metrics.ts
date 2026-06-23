import { apiFetch } from "@/lib/api-client";

export interface HealthzResponse {
	ok: boolean;
	uptime: number;
	version?: string;
	scheduler?: { running: boolean; jobs: number };
	database?: { ok: boolean };
	memory?: { rss: number; heapUsed: number; heapTotal: number };
	quality?: Record<string, number>;
}

export interface PreflightCheck {
	id: string;
	label: string;
	pass: boolean;
	detail?: string;
}

export interface PreflightResponse {
	ok: boolean;
	checks: PreflightCheck[];
}

export async function getHealthz(): Promise<HealthzResponse> {
	return apiFetch<HealthzResponse>("/api/v1/healthz");
}

export async function getPreflight(): Promise<PreflightResponse> {
	return apiFetch<PreflightResponse>("/api/v1/preflight");
}
