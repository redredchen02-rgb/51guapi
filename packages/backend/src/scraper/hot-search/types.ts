export interface HotSearchItem {
	keyword: string;
	heatScore: number; // 0-100 正規化後
	rankPosition: number; // 1-N，越小越熱
}

export type HotSearchScraper = (
	fetchFn?: typeof fetch,
) => Promise<HotSearchItem[]>;
