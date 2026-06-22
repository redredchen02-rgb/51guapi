// Preflight 默认检查集。
//
// 注意:发布/批处理时代的 dry-run 与 trajectory 检查已随发布机器删除,
// 当前 preflight 只覆盖抓取 → 生成 → 导出产品边界仍适用的 green checks。

import type { GreenCheck, RedResidual } from "../types.ts";
import { alarmsPermissionCheck } from "./alarms-permission.ts";
import { backendFailClosedCheck } from "./backend-failclosed.ts";
import { bundleKeyScanCheck } from "./bundle-key-scan.ts";
import { corsIdCheck } from "./cors-id.ts";

export const GREEN_CHECKS: GreenCheck[] = [
	corsIdCheck,
	backendFailClosedCheck,
	bundleKeyScanCheck,
	alarmsPermissionCheck,
];

// 不可逆、仅操作者可做的残留(永不执行、永不计入 pass/fail,只提醒人工把关)。
export const RED_RESIDUALS: RedResidual[] = [
	{
		id: "extension-load-smoke",
		label: "Chrome 扩展人工加载与侧边栏冒烟",
		tier: "red",
		note: "代码可以验证构建产物,但不能替你在 chrome://extensions 加载扩展、打开侧边栏并确认登录/设置 UI 可用。",
	},
	{
		id: "crawl-target-smoke",
		label: "真实抓取目标人工冒烟",
		tier: "red",
		note: "SSRF 白名单和适配器单测不能证明目标站当前 HTML 与网络状态可用;上线前需人工跑一次抓取→入池。",
	},
	{
		id: "export-artifact-review",
		label: "导出 JSON / Markdown 人工抽查",
		tier: "red",
		note: "测试能覆盖格式,但不能判断当日导出的内容是否适合外部使用;至少抽查一条 JSON 与 Markdown。",
	},
];
