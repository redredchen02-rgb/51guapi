// Preflight 聚合器 + CLI 入口(Plan 005 Phase 1 / PR-A,Unit 1)。
//
// 行为(对齐 scripts/check-all.sh 的 `=> ...` UX):
//   - 逐条跑 green 检查,打印 pass/fail + reason;
//   - **始终单独列出** red 残留(「代码无法验证,必须人工把关」);
//   - 退出码:全 green pass → 0;任一 green fail → 非 0;
//   - **零 green 目标 → 判红(防假绿)**;某检查抛异常 → 记 fail + reason,整体判红。

import { pathToFileURL } from "node:url";
import { GREEN_CHECKS, RED_RESIDUALS } from "./checks/index.ts";
import type {
	GreenCheck,
	GreenOutcome,
	PreflightSummary,
	RedResidual,
} from "./types.ts";

/**
 * 纯聚合:跑全部 green 检查,套用假绿守卫,算出整体结论。
 * 不打印、不退出 —— 便于单测。
 */
export async function aggregate(
	greens: GreenCheck[],
	reds: RedResidual[],
): Promise<PreflightSummary> {
	const outcomes: GreenOutcome[] = [];

	for (const check of greens) {
		try {
			const r = await check.run();
			outcomes.push({
				id: check.id,
				label: check.label,
				status: r.status,
				reason: r.reason,
			});
		} catch (e) {
			// 抛异常 = 检查本身坏了,绝不当成 pass。
			const msg = e instanceof Error ? e.message : String(e);
			outcomes.push({
				id: check.id,
				label: check.label,
				status: "fail",
				reason: `检查执行抛出异常:${msg}`,
			});
		}
	}

	const anyFail = outcomes.some((o) => o.status === "fail");

	// 假绿守卫:零 green 目标时,绝不因「没有失败项」而报绿 —— 判红。
	if (greens.length === 0) {
		return {
			greens: outcomes,
			reds,
			ok: false,
			exitCode: 1,
			failReason:
				"零 green 目标:没有任何机械可验证的检查项,无法证明系统就绪(防假绿)。",
		};
	}

	if (anyFail) {
		return {
			greens: outcomes,
			reds,
			ok: false,
			exitCode: 1,
			failReason: "存在未通过的 green 检查项。",
		};
	}

	return { greens: outcomes, reds, ok: true, exitCode: 0 };
}

/** 把汇总渲染为多行文本(供 CLI 打印 / 测试断言)。 */
export function render(summary: PreflightSummary): string {
	const lines: string[] = [];
	lines.push("=> Preflight 自检(PR-A)");
	lines.push("");
	lines.push("=> 机械可验证检查(green):");
	if (summary.greens.length === 0) {
		lines.push("   (无 green 目标 —— 判红,见下方原因)");
	}
	for (const g of summary.greens) {
		const mark = g.status === "pass" ? "PASS" : "FAIL";
		lines.push(`   [${mark}] ${g.label} (${g.id})`);
		lines.push(`          ↳ ${g.reason}`);
	}
	lines.push("");
	lines.push("=> 不可逆残留(red,代码无法替你验证,必须人工把关 / NOT DONE):");
	if (summary.reds.length === 0) {
		lines.push("   (无)");
	}
	for (const r of summary.reds) {
		lines.push(`   [人工] ${r.label} (${r.id})`);
		lines.push(`          ↳ ${r.note}`);
	}
	lines.push("");
	if (summary.ok) {
		lines.push("=> Preflight 通过:全部 green 检查 pass。");
	} else {
		lines.push(`=> Preflight 判红:${summary.failReason ?? "未知原因"}`);
	}
	return lines.join("\n");
}

/** CLI 入口:跑默认检查集,打印,按退出码退出。 */
export async function main(): Promise<void> {
	const summary = await aggregate(GREEN_CHECKS, RED_RESIDUALS);
	console.log(render(summary));
	process.exit(summary.exitCode);
}

// 直接执行(tsx scripts/preflight/runner.ts)时才跑 main;被 import(测试)时不跑。
// 用 pathToFileURL 规范化 argv[1](含空格的路径需 URL 编码后才能与 import.meta.url 比对)。
const invokedDirectly =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	void main();
}
