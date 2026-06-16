import type { FactsBlock } from "@51guapi/shared";

// 扩展内部消息协议(U1:发布/填充机器已拆除,只保留生成 + 读取)。
// 旧版 RuntimeMessage(含 FILL_PAGE/PUBLISH_*/APPROVE_*/FIRST_FLIGHT_* 等发布消息)
// 已随发布机器删除;这里只声明 side panel ↔ background 的生成/读取消息。

export type RuntimeMessage =
	| { type: "GENERATE_DRAFT"; prompt: string }
	| {
			type: "RUN_BATCH";
			topics: string[];
			tabId: number;
			facts?: FactsBlock[];
			iterate?: boolean;
			coverImageUrls?: string[];
			topicIds?: string[];
			enrichments?: (string | undefined)[];
	  }
	| { type: "GET_BATCH" };
