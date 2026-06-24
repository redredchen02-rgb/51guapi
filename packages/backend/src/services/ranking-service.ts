import type { HotSearchKeyword } from "../scraper/hot-search-store.js";
import { listHotSearchKeywords } from "../scraper/hot-search-store.js";
import type { PendingTopic } from "../scraper/pending-store.js";
import { listPendingTopics } from "../scraper/pending-store.js";
import { getBlacklistSet } from "../scraper/ranking-blacklist-store.js";

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
	sectionA: RankedTopic[];
	sectionB: RankedKeyword[];
	freshAt: string;
}

function normalize(s: string): string {
	return s.toLowerCase().replace(/\s+/g, "");
}

/** 双向模糊包含：keyword ⊆ title 或 title ⊆ keyword（空格正規化後）。 */
export function fuzzyMatch(topicTitle: string, keyword: string): boolean {
	if (!topicTitle || !keyword) return false;
	const t = normalize(topicTitle);
	const k = normalize(keyword);
	return t.includes(k) || k.includes(t);
}

function recencyScore(createdAt: string): number {
	const ageMs = Date.now() - new Date(createdAt).getTime();
	const ageH = ageMs / (1000 * 60 * 60);
	if (ageH <= 24) return 1.0;
	if (ageH <= 48) return 0.5;
	return 0.1;
}

/** 按平台聚合熱搜 keyword → Map<keyword, SourcePlatform[]>。 */
function groupKeywordsByPlatform(
	hotKeywords: HotSearchKeyword[],
): Map<string, SourcePlatform[]> {
	const map = new Map<string, SourcePlatform[]>();
	for (const kw of hotKeywords) {
		const existing = map.get(kw.keyword) ?? [];
		existing.push({
			platform: kw.platform,
			rankPosition: kw.rankPosition,
			heatScore: kw.heatScore,
		});
		map.set(kw.keyword, existing);
	}
	return map;
}

function computeScore(
	topic: PendingTopic,
	matchedKeywords: string[],
	keywordMap: Map<string, SourcePlatform[]>,
	totalSites: number,
	siteCount: number,
	weights: { w1: number; w2: number; w3: number; w4: number },
): number {
	const { w1, w2, w3, w4 } = weights;

	// W1: 大瓜 — 幾個平台覆蓋（取所有 matchedKeywords 聯集的平台 Set）
	const platforms = new Set<string>();
	let totalHeat = 0;
	let heatCount = 0;
	for (const kw of matchedKeywords) {
		const srcs = keywordMap.get(kw) ?? [];
		for (const s of srcs) {
			platforms.add(s.platform);
			totalHeat += s.heatScore;
			heatCount++;
		}
	}
	const platformCount = platforms.size;
	const avgHeat = heatCount > 0 ? totalHeat / heatCount : 0;

	return (
		w1 * (platformCount / 4) +
		w2 * (avgHeat / 100) +
		w3 * (totalSites > 0 ? siteCount / totalSites : 0) +
		w4 * recencyScore(topic.createdAt)
	);
}

function loadWeights() {
	return {
		w1: parseFloat(process.env.RANK_W1_BIG ?? "0.4"),
		w2: parseFloat(process.env.RANK_W2_TRAFFIC ?? "0.3"),
		w3: parseFloat(process.env.RANK_W3_SITE ?? "0.2"),
		w4: parseFloat(process.env.RANK_W4_RECENCY ?? "0.1"),
	};
}

export async function getRankedList(): Promise<RankingResult> {
	const freshAt = new Date().toISOString();

	// 1. 取所有 pending 狀態的 gossip 選題（最多 500）
	const topics = await listPendingTopics(
		500,
		"pending",
		"created_at",
		"gossip",
	);

	// 2. 取未過期熱搜詞
	const hotKeywords = listHotSearchKeywords();

	// 3. 黑名單
	const blacklist = getBlacklistSet();

	// 4. 熱搜詞聚合：keyword → platforms[]
	const keywordMap = groupKeywordsByPlatform(hotKeywords);

	// 5. 過濾黑名單關鍵詞
	const activeKeywords = [...keywordMap.keys()].filter(
		(k) => !blacklist.has(k),
	);

	// 6. 所有不在黑名單的站點名稱（用於 siteCount 分母）
	const allSites = new Set(topics.map((t) => t.siteName));
	const totalSites = allSites.size;

	const weights = loadWeights();

	// 7. 每條 topic 計算 matchedKeywords 和 score
	const sectionA: RankedTopic[] = [];
	const topicsWithMatch = new Set<string>(); // 記錄哪些 topic 的 title 已匹配

	for (const topic of topics) {
		// 過濾黑名單 title
		if (blacklist.has(topic.title)) continue;

		const matchedKeywords = activeKeywords.filter((k) =>
			fuzzyMatch(topic.title, k),
		);
		if (matchedKeywords.length === 0) continue;

		// 計算此 topic 的 siteCount（同 keyword 在幾個站點出現）
		const coveredKeywordSites = new Set<string>();
		for (const kw of matchedKeywords) {
			// 找所有其他 topic 匹配同一 kw 的站點
			for (const t of topics) {
				if (fuzzyMatch(t.title, kw)) coveredKeywordSites.add(t.siteName);
			}
		}

		// 聚合 sourcePlatforms
		const platforms = new Set<string>();
		const sourcePlatforms: SourcePlatform[] = [];
		for (const kw of matchedKeywords) {
			for (const src of keywordMap.get(kw) ?? []) {
				if (!platforms.has(src.platform)) {
					platforms.add(src.platform);
					sourcePlatforms.push(src);
				}
			}
		}

		const score = computeScore(
			topic,
			matchedKeywords,
			keywordMap,
			totalSites,
			coveredKeywordSites.size,
			weights,
		);

		sectionA.push({
			topicId: topic.id,
			title: topic.title,
			siteName: topic.siteName,
			score,
			platformCount: platforms.size,
			siteCount: coveredKeywordSites.size,
			matchedKeywords,
			sourcePlatforms,
			sourceUrl: topic.sourceUrl,
			createdAt: topic.createdAt,
		});

		// 記錄哪些 keyword 已被 A 區 topic 覆蓋
		for (const kw of matchedKeywords) topicsWithMatch.add(kw);
	}

	// 8. B 區：熱搜 keyword 但未被任何 topic 覆蓋
	const sectionB: RankedKeyword[] = [];
	for (const kw of activeKeywords) {
		if (topicsWithMatch.has(kw)) continue;
		const srcs = keywordMap.get(kw) ?? [];
		const avgHeat =
			srcs.length > 0
				? srcs.reduce((s, r) => s + r.heatScore, 0) / srcs.length
				: 0;
		sectionB.push({
			keyword: kw,
			platforms: srcs,
			platformCount: new Set(srcs.map((s) => s.platform)).size,
			avgHeatScore: avgHeat,
		});
	}

	// 9. 排序
	sectionA.sort((a, b) => b.score - a.score);
	sectionB.sort(
		(a, b) =>
			b.platformCount - a.platformCount || b.avgHeatScore - a.avgHeatScore,
	);

	return { sectionA, sectionB, freshAt };
}
