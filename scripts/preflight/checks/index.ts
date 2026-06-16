// Preflight 默认检查集(Unit 2 全套 green + red 残留清单)。
//
// 注意:metrics 自增检查被**故意排除**(plan Key Decisions:死指标),勿加回。

import type { GreenCheck, RedResidual } from "../types.ts";
import { alarmsPermissionCheck } from "./alarms-permission.ts";
import { backendFailClosedCheck } from "./backend-failclosed.ts";
import { bundleKeyScanCheck } from "./bundle-key-scan.ts";
import { corsIdCheck } from "./cors-id.ts";
import { dryRunGreenCheck } from "./dryrun-green.ts";
import { trajectoryVerifyCheck } from "./trajectory-verify.ts";

export const GREEN_CHECKS: GreenCheck[] = [
	corsIdCheck,
	backendFailClosedCheck,
	bundleKeyScanCheck,
	dryRunGreenCheck,
	trajectoryVerifyCheck,
	alarmsPermissionCheck,
];

// 不可逆、仅操作者可做的残留(永不执行、永不计入 pass/fail,只提醒人工把关)。
export const RED_RESIDUALS: RedResidual[] = [
	{
		id: "real-backend-smoke",
		label: "真后台人工冒烟(动态 layui handler 实发一次)",
		tier: "red",
		note: "fixture 的 submit=0 只证明填充逻辑不提交;真后台动态提交 handler 只能靠人工登录后台、实跑一条授权发布来兜底。代码无法替你验证。",
	},
	{
		id: "extension-reload",
		label: "chrome://extensions 重载扩展并刷新目标页",
		tier: "red",
		note: "改 content script 后旧脚本仍驻留,必须人工在 chrome://extensions 重载扩展并刷新目标页。代码无法替你验证。",
	},
	{
		id: "fixture-resnapshot",
		label: "后台漂移时重抓并脱敏 fixture",
		tier: "red",
		note: "重抓 fixture 接触真后台登录态,属高危操作:人工 dump → 按 allowlist 脱敏 → check:fixtures 绿 → 覆盖。代码无法替你验证。",
	},
];
