import type { ContentDraft } from "@51guapi/shared";
import { useCallback } from "react";
import { requestGenerate } from "../../../lib/messaging";

/**
 * 「生成草稿」的归一化结果(判别式联合)。
 * 把 requestGenerate 的成功/失败响应与抛出的异常,折叠成调用方易于 switch 的四态:
 * - ok        : 生成成功,draft 可用
 * - no-key    : 后端报告缺 API Key(res.ok===false && res.kind==="no-key")
 * - error     : 后端报告的其他生成失败(res.ok===false,非 no-key)
 * - exception : requestGenerate 抛错(SW 超时等)
 *
 * 注意:此 hook 只做「调用 + try/catch + 归一」,不触碰任何组件状态。
 * 进度条 / 防竞态 token / busy / 状态文案等编排,仍由各调用方按自身语义保留。
 *
 * exception 故意保留原始 `error: unknown` 透传,**不替调用方决定兜底文案**:
 * 三处对「非 Error 异常」的兜底文案各异(生成失败 / 请重试),由调用方用
 * `err instanceof Error ? err.message : <自己的兜底>` 还原,确保逐字行为不变。
 */
export type DraftGenerationResult =
	| { status: "ok"; draft: ContentDraft }
	| { status: "no-key"; error: string }
	| { status: "error"; error: string }
	| { status: "exception"; error: unknown };

interface UseDraftGenerationReturn {
	generate: (prompt: string) => Promise<DraftGenerationResult>;
}

export function useDraftGeneration(): UseDraftGenerationReturn {
	const generate = useCallback(
		async (prompt: string): Promise<DraftGenerationResult> => {
			try {
				const res = await requestGenerate(prompt);
				if (res.ok) {
					return { status: "ok", draft: res.draft };
				}
				return {
					status: res.kind === "no-key" ? "no-key" : "error",
					error: res.error,
				};
			} catch (err) {
				return { status: "exception", error: err };
			}
		},
		[],
	);

	return { generate };
}
