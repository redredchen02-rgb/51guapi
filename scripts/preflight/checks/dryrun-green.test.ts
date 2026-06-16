// @vitest-environment jsdom
import type { ContentDraft } from "@51guapi/shared";
import { describe, expect, it } from "vitest";
import type { Batch } from "../../../packages/extension/lib/batch.ts";
import {
	type ApproveBatchDeps,
	approveBatch,
} from "../../../packages/extension/lib/batch-orchestrator.ts";
import { evaluateDryRun } from "./dryrun-green.ts";

describe("evaluateDryRun", () => {
	it("dry-run 产出报告且零提交 → PASS", async () => {
		const r = await evaluateDryRun();
		expect(r.status).toBe("pass");
		expect(r.reason).toContain("提交计数 = 0");
	});

	it("特征化:若 evaluateGate=authorized 且 sendGrant 真发,submit>0(应被零提交档拦下)", async () => {
		const draft: ContentDraft = {
			id: "i0",
			title: "t",
			subtitle: "",
			category: "2",
			coverImageUrl: "",
			body: "<p>x</p>",
			tags: [],
			description: "",
			postStatus: "0",
			publishedAt: "2026-06-15",
			mediaId: "1",
			status: "draft",
			createdAt: "2026-06-15T00:00:00.000Z",
		};
		let batch = {
			id: "b",
			tabId: 1,
			authorizedHost: "h",
			createdAt: "2026-06-15T00:00:00.000Z",
			items: [{ id: "i0", topic: "t", status: "awaiting-approval", draft }],
		} as Batch;
		let submit = 0;
		const deps: ApproveBatchDeps = {
			getBatch: async () => batch,
			save: async (b) => {
				batch = b;
			},
			pinnedHostOk: async () => true,
			sendFill: async () => ({ ok: true as const, results: [] }),
			// authorized + allowed → 会真的走到 sendGrant。
			evaluateGate: async () => ({
				mode: "authorized" as const,
				allowed: true,
				host: "h",
			}),
			sendGrant: async () => {
				submit += 1;
				return { ok: true, dryRun: false, url: "https://x" };
			},
			appendTrajectory: async () => ({ snapshotDropped: false }),
		};
		await approveBatch(deps);
		// 证明:authorized 档会触发提交(对比 dry-run 档的零提交不变量)。
		expect(submit).toBeGreaterThan(0);
	});
});
