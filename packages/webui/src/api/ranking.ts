import type { ContentDraft } from "@51guapi/shared";
import { apiFetch } from "@/lib/api-client";

export interface SourcePlatform {
	platform: string;
	rankPosition: number;
	heatScore: number;
}

export interface RankedTopic {
	topicId: string;
	title: string;
	siteName: string;
	score: number;
	platformCount: number;
	siteCount: number;
	matchedKeywords: string[];
	sourcePlatforms: SourcePlatform[];
	sourceUrl: string;
	createdAt: string;
}

export interface RankedKeyword {
	keyword: string;
	platforms: SourcePlatform[];
	platformCount: number;
	avgHeatScore: number;
}

export interface RankingResult {
	ok: boolean;
	sectionA: RankedTopic[];
	sectionB: RankedKeyword[];
	freshAt: string;
}

export interface ScrapeResult {
	ok: boolean;
	hotKeywordsCount: number;
	topicsDiscovered: number;
	errors: string[];
}

export async function getRanking(): Promise<RankingResult> {
	return apiFetch<RankingResult>("/api/v1/ranking");
}

export async function triggerScrape(): Promise<ScrapeResult> {
	return apiFetch<ScrapeResult>("/api/v1/ranking/scrape", { method: "POST" });
}

export async function hideKeyword(keyword: string): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>("/api/v1/ranking/hide", {
		method: "POST",
		body: JSON.stringify({ keyword }),
	});
}

export interface GenerateDraftResult {
	ok: boolean;
	draft?: ContentDraft;
	qualityWarnings?: string[];
	error?: string;
	kind?: string;
}

export async function generateDraftFromRanking(
	topicId: string,
): Promise<GenerateDraftResult> {
	return apiFetch<GenerateDraftResult>(
		`/api/v1/ranking/generate-draft/${topicId}`,
		{ method: "POST" },
	);
}
