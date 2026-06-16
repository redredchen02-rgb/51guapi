// green 检查:CORS_ORIGIN 必须等于「从扩展公钥派生的扩展来源」,且不得为 `*`/空。
//
// 这是新逻辑(env-check 只验「非空、非 `*`」;此处额外验「= 期望扩展 id」)。
// 复用 env-check 的非空/非 `*` 分支语义,再叠加 id 精确匹配。
// 允许 CORS_ORIGIN 逗号分隔多来源(dev+prod);只要其中一个等于派生来源即通过。

import { checkEnv } from "../../../packages/backend/src/config/env-check.ts";
import type { CheckResult, GreenCheck } from "../types.ts";
import { deriveExtensionOrigin, EXTENSION_KEY } from "./extension-id.ts";

/** 纯函数:给定 env,判断 CORS_ORIGIN 是否 = 派生扩展来源(且非空/非 `*`)。 */
export function evaluateCorsId(env: NodeJS.ProcessEnv): CheckResult {
	const expected = deriveExtensionOrigin(EXTENSION_KEY);

	// 复用 env-check 的非空/非 `*` 判定:只看 CORS 这一项是否被它判错。
	const corsErr = checkEnv(env).find((e) => e.startsWith("CORS_ORIGIN"));
	if (corsErr) {
		return {
			status: "fail",
			reason: `CORS_ORIGIN 未设置或为通配符 '*'(env-check 拒绝)。期望 = ${expected}`,
		};
	}

	const origins = (env.CORS_ORIGIN ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	if (!origins.includes(expected)) {
		return {
			status: "fail",
			reason: `CORS_ORIGIN 未包含派生的扩展来源。期望含 ${expected},实际 = [${origins.join(", ")}]`,
		};
	}

	return {
		status: "pass",
		reason: `CORS_ORIGIN 含派生扩展来源 ${expected}(非 '*')。`,
	};
}

export const corsIdCheck: GreenCheck = {
	id: "cors-id",
	label: "CORS_ORIGIN 等于派生的扩展来源(非通配)",
	tier: "green",
	run: async () => evaluateCorsId(process.env),
};
