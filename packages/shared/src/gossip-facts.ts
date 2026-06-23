import { HTTP_URL_PATTERN } from "./link-source.js";

/** 吃瓜（娛樂八卦）選題的結構化事實。全欄位可為 null；缺失欄位不編造。 */
export interface GossipFactsBlock {
	當事人: string | null;
	事件摘要: string | null;
	起因: string | null;
	經過: string | null;
	結果: string | null;
	來源連結: string | null;
	發生時間: string | null;
	熱度標籤: string | null;
}

export type GossipFactKey = keyof GossipFactsBlock;

/** 含 URL 的吃瓜事实字段(grounding 来源校验的允许集来自这些;对应 ACG 的 URL_FIELDS)。 */
const GOSSIP_URL_FIELDS: GossipFactKey[] = ["來源連結"];

/**
 * 收集吃瓜 facts 里出现的所有 URL(grounding 校验的允许集)。
 * 镜像 facts.factUrls(ACG),但读吃瓜的「來源連結」—— 让后端 grounding 闸对吃瓜
 * 草稿也有正确允许集(否则允许集恒空,合法来源链接会被误判 unsourced)。
 */
export function gossipFactUrls(facts: GossipFactsBlock): string[] {
	const urls: string[] = [];
	const urlRe = new RegExp(HTTP_URL_PATTERN, "gi");
	for (const k of GOSSIP_URL_FIELDS) {
		const v = facts[k];
		if (!v) continue;
		const m = v.match(urlRe);
		if (m) urls.push(...m);
	}
	return urls;
}

export const GOSSIP_FACT_KEYS: GossipFactKey[] = [
	"當事人",
	"事件摘要",
	"起因",
	"經過",
	"結果",
	"來源連結",
	"發生時間",
	"熱度標籤",
];

/** json_schema 定義，供 gossip-fact-extractor structured output 使用。 */
export const GOSSIP_FACTS_SCHEMA = {
	type: "object",
	properties: {
		當事人: {
			type: ["string", "null"],
			description: "涉及的人名或組合，逗號分隔",
		},
		事件摘要: { type: ["string", "null"], description: "一兩句概括事件核心" },
		起因: { type: ["string", "null"], description: "事件起因" },
		經過: { type: ["string", "null"], description: "事件經過" },
		結果: { type: ["string", "null"], description: "事件結果或當前狀態" },
		來源連結: { type: ["string", "null"], description: "原文 URL，verbatim" },
		發生時間: {
			type: ["string", "null"],
			description: "事件發生時間，如 2024-05",
		},
		熱度標籤: {
			type: ["string", "null"],
			description: "如「出軌」「解約」「撕逼」「公開戀情」，逗號分隔",
		},
	},
	required: GOSSIP_FACT_KEYS,
	additionalProperties: false,
} as const;
