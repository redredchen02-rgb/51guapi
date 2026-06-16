// green 检查:后端 fail-closed 校验真的会拒绝弱配置。
//
// 复用 backend/src/config/env-check 的 checkEnv()/validateEnv():
// 喂入一组「坏样本」(弱 JWT、无效 hash、CORS=*),断言 checkEnv 报错、validateEnv 抛出。
// 不监听真实端口、不读真实 .env —— 纯逻辑断言。

import {
	checkEnv,
	validateEnv,
} from "../../../packages/backend/src/config/env-check.ts";
import type { CheckResult, GreenCheck } from "../types.ts";

/** 一组必须被拒绝的坏配置样本。 */
const BAD_SAMPLES: { label: string; env: NodeJS.ProcessEnv }[] = [
	{
		label: "弱 JWT_SECRET",
		env: {
			JWT_SECRET: "secret",
			JWT_ADMIN_PASSWORD_HASH: "x",
			CORS_ORIGIN: "chrome-extension://abc",
		},
	},
	{
		label: "无效 JWT_ADMIN_PASSWORD_HASH",
		env: {
			JWT_SECRET: "a".repeat(48),
			JWT_ADMIN_PASSWORD_HASH: "not-a-hash",
			CORS_ORIGIN: "chrome-extension://abc",
		},
	},
	{
		label: "CORS_ORIGIN 通配 '*'",
		env: {
			JWT_SECRET: "a".repeat(48),
			JWT_ADMIN_PASSWORD_HASH: `${"a".repeat(32)}:${"b".repeat(128)}`,
			CORS_ORIGIN: "*",
		},
	},
];

export function evaluateFailClosed(): CheckResult {
	for (const sample of BAD_SAMPLES) {
		const errors = checkEnv(sample.env);
		if (errors.length === 0) {
			return {
				status: "fail",
				reason: `坏样本「${sample.label}」未被 checkEnv 拒绝(fail-closed 失效)。`,
			};
		}
		let threw = false;
		try {
			validateEnv(sample.env);
		} catch {
			threw = true;
		}
		if (!threw) {
			return {
				status: "fail",
				reason: `坏样本「${sample.label}」未让 validateEnv 抛出(fail-closed 失效)。`,
			};
		}
	}
	return {
		status: "pass",
		reason: `${BAD_SAMPLES.length} 个弱配置样本均被 fail-closed 校验拒绝。`,
	};
}

export const backendFailClosedCheck: GreenCheck = {
	id: "backend-failclosed",
	label: "后端 fail-closed 校验拒绝弱配置",
	tier: "green",
	run: async () => evaluateFailClosed(),
};
