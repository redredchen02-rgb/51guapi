import type { PendingTopic } from "./types.js";

/**
 * Canonical GossipSite type — shared across extension and webui.
 * extension has: enabled + updatedAt (required)
 * webui has: lastDiscoverAt + lastDiscoverCount (optional)
 * This type is the union of both; each consumer uses only the fields it needs.
 */
export interface GossipSite {
	id: string;
	name: string;
	listUrl: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	lastDiscoverAt?: string | null;
	lastDiscoverCount?: number | null;
}

/** 题材计数项（题材选择器用）。 */
export interface ThemeCount {
	theme: string;
	count: number;
}

/**
 * Canonical PendingTopicsResponse — union of extension and webui shapes.
 * topics optional (absent on error), total optional (absent in extension).
 */
export interface PendingTopicsResponse {
	ok: boolean;
	topics?: PendingTopic[];
	total?: number;
	error?: string;
}
