import {
	assembleDraftJSON,
	assembleDraftMarkdown,
	assembleTopicsCSV,
	type ContentDraft,
	type GossipFactsBlock,
	type TopicForCSV,
} from "@51guapi/shared";

/** 把草稿序列化為格式化 JSON 字串。 */
export function exportDraftAsJSON(
	draft: ContentDraft,
	facts?: GossipFactsBlock | null,
): string {
	return JSON.stringify(assembleDraftJSON(draft, facts), null, 2);
}

/** 把草稿組裝為可讀 Markdown 字串。 */
export function exportDraftAsMarkdown(
	draft: ContentDraft,
	facts?: GossipFactsBlock | null,
): string {
	return assembleDraftMarkdown(draft, facts);
}

/** 把待審池整批組裝為 CSV 字串(元資料 + 8 個吃瓜事實欄)。包裝 shared 純函式。 */
export function exportTopicsAsCSV(topics: TopicForCSV[]): string {
	return assembleTopicsCSV(topics);
}

/** 寫入系統剪貼板。瀏覽器環境用 navigator.clipboard;測試可 mock。 */
export async function copyToClipboard(text: string): Promise<void> {
	await navigator.clipboard.writeText(text);
}

/** 以 Blob + a[download] 觸發瀏覽器下載。測試可 mock。 */
export function downloadFile(
	filename: string,
	content: string,
	mime: string,
): void {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/** 由草稿 title 生成安全檔名(去非法字元)。 */
export function safeFilename(draft: ContentDraft, ext: string): string {
	const base = (draft.title || draft.id || "draft")
		.replace(/[\\/:*?"<>|]/g, "_")
		.replace(/\s+/g, "-")
		.slice(0, 60);
	return `${base}.${ext}`;
}
