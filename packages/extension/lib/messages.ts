import type { FactsBlock, GossipFactsBlock } from "@51guapi/shared";

export interface GenerateDraftOptions {
	facts?: FactsBlock | GossipFactsBlock;
	enrichment?: string;
}

// 扩展内部消息协议(发布/填充/批量机器已拆除,只保留单条生成消息)。
export type RuntimeMessage = {
	type: "GENERATE_DRAFT";
	prompt: string;
	options?: GenerateDraftOptions;
};
