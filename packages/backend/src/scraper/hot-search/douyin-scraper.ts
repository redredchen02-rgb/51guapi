import type { HotSearchItem } from "./types.js";

// Phase 2 stub — msToken 需客戶端 JS 計算（HMAC），純 HTTP 大機率 403。
// 保留 interface 與其他 scraper 一致，Phase 2 加入 Playwright 薄層取 cookie。
export async function scrapeDouyin(
	_fetchFn?: typeof fetch,
): Promise<HotSearchItem[]> {
	console.warn("[douyin-scraper] Phase 2 stub — skipping Douyin hot search");
	return [];
}
