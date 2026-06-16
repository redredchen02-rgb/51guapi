// green 检查:扩展 manifest 必须声明 `alarms` 权限。
//
// 缺此权限会让 chrome.alarms 为 undefined → background main() 启动即抛 → SW 整个失效。
// 这里直接解析 wxt.config.ts 文本里的 permissions 数组(零运行时依赖,不引 WXT)。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CheckResult, GreenCheck } from "../types.ts";

const WXT_CONFIG = fileURLToPath(
	new URL("../../../packages/extension/wxt.config.ts", import.meta.url),
);

/** 从 wxt.config.ts 文本提取 permissions 数组里的字符串(简易解析,够用)。 */
export function parsePermissions(source: string): string[] {
	const m = source.match(/permissions:\s*\[([^\]]*)\]/);
	if (!m) return [];
	return [...m[1].matchAll(/["']([^"']+)["']/g)].map((g) => g[1] as string);
}

export function evaluateAlarms(source: string): CheckResult {
	const perms = parsePermissions(source);
	if (!perms.includes("alarms")) {
		return {
			status: "fail",
			reason: `wxt.config.ts permissions 缺少 'alarms'(SW keep-alive 会失效)。实际 = [${perms.join(", ")}]`,
		};
	}
	return {
		status: "pass",
		reason: `wxt.config.ts permissions 含 'alarms'。实际 = [${perms.join(", ")}]`,
	};
}

export const alarmsPermissionCheck: GreenCheck = {
	id: "alarms-permission",
	label: "扩展 manifest 声明 alarms 权限",
	tier: "green",
	run: async () => evaluateAlarms(readFileSync(WXT_CONFIG, "utf8")),
};
