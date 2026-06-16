// green 检查:对冻结 fixture 的内容跑一次 dry-run 批准,断言
//   ① 产出非空 DryRunReport(预演成功);
//   ② 零提交(dry-run 档 sendGrant 绝不被调用,submit 计数恒 0)。
//
// 用 approveBatch + 全注入 stub deps,不引任何需要 #imports(WXT 虚拟模块)的运行时;
// evaluateGate 固定 'dry-run' → orchestratePublish 走「不发准许」分支,从结构上保证零提交。
//
// 说明:verifyLinks/evaluateGrounding 是纯函数(无 DOM 依赖,见 grounding-gate.ts 注释),
// 此 dry-run 不触发授权档 grounding 硬闸,故无需 DOMParser/linkedom,无跳过项。

import type { ContentDraft } from "@51guapi/shared";
import type { Batch } from "../../../packages/extension/lib/batch.ts";
import {
	type ApproveBatchDeps,
	approveBatch,
} from "../../../packages/extension/lib/batch-orchestrator.ts";
import type { CheckResult, GreenCheck } from "../types.ts";

const HOST = "dx-999-adm.ympxbys.xyz";

function makeDraft(id: string, title: string): ContentDraft {
	return {
		id,
		title,
		subtitle: "副标题",
		category: "2",
		coverImageUrl: "",
		body: "<p>预演正文</p>",
		tags: [],
		description: "描述",
		postStatus: "0",
		publishedAt: "2026-06-15",
		mediaId: "1",
		status: "draft",
		createdAt: "2026-06-15T00:00:00.000Z",
	};
}

function makeAwaitingBatch(): Batch {
	return {
		id: "preflight_dryrun",
		tabId: 1,
		authorizedHost: HOST,
		createdAt: "2026-06-15T00:00:00.000Z",
		items: [
			{
				id: "item_0",
				topic: "预演选题",
				status: "awaiting-approval",
				draft: makeDraft("item_0", "预演标题"),
			},
		],
	} as Batch;
}

export async function evaluateDryRun(): Promise<CheckResult> {
	let batch = makeAwaitingBatch();
	let submitCount = 0;
	let report: { items: unknown[] } | null = null;

	const deps: ApproveBatchDeps = {
		getBatch: async () => batch,
		save: async (b) => {
			batch = b;
		},
		pinnedHostOk: async () => true,
		// 填充结果(无副作用 stub);非空 results 以便报告有内容。
		sendFill: async () => ({
			ok: true as const,
			results: [{ field: "title", ok: true, value: "" } as never],
		}),
		// dry-run 档:orchestratePublish 直接返回 {ok,dryRun:true},不会调 sendGrant。
		evaluateGate: async () => ({
			mode: "dry-run" as const,
			allowed: false,
			host: HOST,
		}),
		// 若被调用即视为「提交」—— 计数必须保持 0。
		sendGrant: async () => {
			submitCount += 1;
			return { ok: true, dryRun: false };
		},
		appendTrajectory: async () => ({ snapshotDropped: false }),
		saveDryRunReportFn: async (r) => {
			report = r;
		},
	};

	await approveBatch(deps);

	if (submitCount !== 0) {
		return {
			status: "fail",
			reason: `dry-run 期间 sendGrant 被调用 ${submitCount} 次(应为 0,零提交被破坏)。`,
		};
	}
	if (!report || (report as { items: unknown[] }).items.length === 0) {
		return {
			status: "fail",
			reason: "dry-run 未产出非空 DryRunReport(预演失败)。",
		};
	}
	return {
		status: "pass",
		reason: `dry-run 预演产出 ${(report as { items: unknown[] }).items.length} 条报告项,提交计数 = 0。`,
	};
}

export const dryRunGreenCheck: GreenCheck = {
	id: "dryrun-green",
	label: "dry-run 预演产出报告且零提交",
	tier: "green",
	run: () => evaluateDryRun(),
};
