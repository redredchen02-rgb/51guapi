import type { GossipFactsBlock } from "./gossip-facts.js";
import { GOSSIP_FACT_KEYS } from "./gossip-facts.js";
import type { ContentDraft, DraftStatus } from "./types.js";

export type ExportFormat = "json" | "markdown";

/** 導出版本標記,寫進 JSON 元資料,方便日後解析端做相容處理。 */
export const EXPORT_SCHEMA_VERSION = "0.1";

/** 結構化導出物件(JSON 還原後的形狀)。 */
export interface ExportedDraft {
	schemaVersion: string;
	exportedAt: string;
	draft: {
		id: string;
		title: string;
		subtitle: string;
		description: string;
		category: string;
		tags: string[];
		coverImageUrl: string;
		body: string;
		status: DraftStatus;
		createdAt: string;
	};
	/** 吃瓜事實結構;無事實時為 null。 */
	gossipFacts: GossipFactsBlock | null;
}

/** 把吃瓜草稿組裝成結構化導出物件(供 JSON.stringify)。純函式。 */
export function assembleDraftJSON(
	draft: ContentDraft,
	facts?: GossipFactsBlock | null,
	now?: string,
): ExportedDraft {
	return {
		schemaVersion: EXPORT_SCHEMA_VERSION,
		exportedAt: now ?? new Date().toISOString(),
		draft: {
			id: draft.id,
			title: draft.title,
			subtitle: draft.subtitle,
			description: draft.description,
			category: draft.category,
			tags: [...draft.tags],
			coverImageUrl: draft.coverImageUrl,
			body: draft.body,
			status: draft.status,
			createdAt: draft.createdAt,
		},
		gossipFacts: facts ?? null,
	};
}

/** CSV 批量導出用的選題形狀(待審池子集);facts 為 key→值的字典,缺項即空。 */
export interface TopicForCSV {
	id: string;
	title: string;
	siteName: string;
	sourceUrl: string;
	confidence: number;
	/** 質量分(可選);無則該欄輸出空。 */
	qualityScore?: number;
	domain?: string;
	createdAt: string;
	facts: Record<string, string | null | undefined>;
}

/** CSV 元資料欄(吃瓜事實 8 欄之前的列頭)。 */
const CSV_META_HEADERS = [
	"id",
	"title",
	"siteName",
	"sourceUrl",
	"confidence",
	"score",
	"domain",
	"createdAt",
] as const;

/**
 * 轉義單個 CSV 格:含 , " 或換行時用雙引號包裹並把 " → ""。null/undefined → 空串。
 *
 * Security(CSV 公式注入):不可信外站內容若以 = + - @ Tab CR 起首,在 Excel/Sheets
 * 打開時會被當公式求值(資料外洩/DDE)。對「字串」值前置單引號中和;數字列
 * (confidence/score)不受影響,避免誤傷。
 */
export function escapeCsv(val: string | number | null | undefined): string {
	if (val == null) return "";
	let s = String(val);
	if (typeof val === "string" && /^[=+\-@\t\r]/.test(s)) {
		s = `'${s}`;
	}
	if (/[",\r\n]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

/**
 * 把待審池組裝成 CSV 字串(表頭 + 逐 topic 一列)。純函式。
 * 欄位 = 8 個元資料欄 + 8 個吃瓜事實欄(GOSSIP_FACT_KEYS,從 topic.facts 取,缺即空)。
 * 行以 CRLF 分隔(CSV 標準);空列表只輸出表頭行。
 */
export function assembleTopicsCSV(topics: TopicForCSV[]): string {
	const headers = [...CSV_META_HEADERS, ...GOSSIP_FACT_KEYS];
	const rows: string[] = [headers.map(escapeCsv).join(",")];

	for (const t of topics) {
		const cells: (string | number | null | undefined)[] = [
			t.id,
			t.title,
			t.siteName,
			t.sourceUrl,
			t.confidence,
			t.qualityScore,
			t.domain,
			t.createdAt,
			...GOSSIP_FACT_KEYS.map((k) => t.facts?.[k] ?? ""),
		];
		rows.push(cells.map(escapeCsv).join(","));
	}

	return rows.join("\r\n");
}

/** 轉義 Markdown 行內特殊字元(# | * _ ` [ ] 反斜線);換行統一為 \n。 */
function escMd(s: string): string {
	return s
		.replace(/\\/g, "\\\\")
		.replace(/([#|*_`[\]])/g, "\\$1")
		.replace(/\r\n?/g, "\n");
}

/** 去 HTML 標籤,得到 Markdown 正文用的純文字(保留段落換行)。 */
function htmlToPlain(html: string): string {
	return html
		.replace(/<\s*br\s*\/?\s*>/gi, "\n")
		.replace(/<\/\s*(p|div|h[1-6]|li)\s*>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** 把吃瓜草稿組裝成可讀 Markdown。純函式;缺欄位省略對應段落。 */
export function assembleDraftMarkdown(
	draft: ContentDraft,
	facts?: GossipFactsBlock | null,
): string {
	const lines: string[] = [];

	lines.push(`# ${escMd(draft.title || "(无标题)")}`);
	lines.push("");

	if (draft.subtitle.trim()) {
		lines.push(`> ${escMd(draft.subtitle)}`);
		lines.push("");
	}

	if (draft.description.trim()) {
		lines.push(escMd(draft.description));
		lines.push("");
	}

	const body = htmlToPlain(draft.body);
	if (body) {
		// 正文每段獨立轉義,段間留空行。
		for (const para of body.split(/\n{2,}/)) {
			const p = para.trim();
			if (p) {
				lines.push(escMd(p));
				lines.push("");
			}
		}
	}

	if (draft.tags.length > 0) {
		lines.push(`**标签**: ${draft.tags.map((t) => escMd(t)).join(", ")}`);
		lines.push("");
	}

	if (facts) {
		const factLines = GOSSIP_FACT_KEYS.map((k) => {
			const v = facts[k];
			return v == null || v === "" ? null : `- **${k}**: ${escMd(String(v))}`;
		}).filter((l): l is string => l !== null);
		if (factLines.length > 0) {
			lines.push("## 吃瓜事实");
			lines.push("");
			lines.push(...factLines);
			lines.push("");
		}
	}

	// 來源連結:優先取吃瓜事實的來源連結。
	const source = facts?.來源連結?.trim();
	if (source) {
		lines.push(`**来源**: ${escMd(source.replace(/\s+/g, " "))}`);
		lines.push("");
	}

	return `${lines.join("\n").trimEnd()}\n`;
}
