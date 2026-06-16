// green 检查:构建产物里不得夹带「私钥/API key 形状」的明文。
//
// 安全要点:**只报布尔**(发现/未发现),reason 绝不回显任何疑似明文 ——
// 否则自检报告本身就成了泄密面。
//
// `.output/` 不存在 = 0 个可扫目标 → 判 fail 并提示「先构建」(防假绿:没产物不能算过)。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckResult, GreenCheck } from "../types.ts";

const OUTPUT_DIR = fileURLToPath(
	new URL("../../../packages/extension/.output", import.meta.url),
);

// key 形状(只识别形状,不记录命中内容):
//   - PEM 私钥头
//   - 长 base64(扩展公钥/私钥 DER 常见,>200 连续 base64 字符)
//   - 常见 API key 前缀(sk-、AKIA…)
const KEY_PATTERNS: RegExp[] = [
	/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
	/[A-Za-z0-9+/]{200,}={0,2}/,
	/\bsk-[A-Za-z0-9]{20,}\b/,
	/\bAKIA[0-9A-Z]{16}\b/,
];

const TEXT_EXT = new Set([
	".js",
	".mjs",
	".cjs",
	".json",
	".html",
	".css",
	".map",
	".txt",
]);

function listFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) out.push(...listFiles(full));
		else out.push(full);
	}
	return out;
}

/** 纯函数:扫一组文件,只返回「命中文件数」(布尔友好),不返回任何明文。 */
export function scanForKeys(files: { name: string; content: string }[]): {
	hitCount: number;
	scanned: number;
} {
	let hitCount = 0;
	for (const f of files) {
		if (KEY_PATTERNS.some((re) => re.test(f.content))) hitCount += 1;
	}
	return { hitCount, scanned: files.length };
}

export function evaluateBundleScan(outputDir: string): CheckResult {
	let files: string[];
	try {
		const st = statSync(outputDir);
		if (!st.isDirectory()) throw new Error("not a dir");
		files = listFiles(outputDir);
	} catch {
		return {
			status: "fail",
			reason:
				".output/ 不存在(0 个可扫目标)。先构建扩展(pnpm build:extension)再跑此检查。",
		};
	}

	const texts = files
		.filter((f) => TEXT_EXT.has(f.slice(f.lastIndexOf("."))))
		.map((f) => ({ name: f, content: readFileSync(f, "utf8") }));

	if (texts.length === 0) {
		return {
			status: "fail",
			reason: ".output/ 内无可扫文本文件(0 个目标),构建可能不完整。",
		};
	}

	const { hitCount, scanned } = scanForKeys(texts);
	if (hitCount > 0) {
		// 只报数量,绝不回显命中内容。
		return {
			status: "fail",
			reason: `产物中发现 ${hitCount}/${scanned} 个文件含 key 形状字符串(已隐藏明文)。请核查构建是否夹带密钥。`,
		};
	}
	return {
		status: "pass",
		reason: `扫描 ${scanned} 个产物文本文件,未发现 key 形状明文。`,
	};
}

export const bundleKeyScanCheck: GreenCheck = {
	id: "bundle-key-scan",
	label: "构建产物无 key 形状明文",
	tier: "green",
	run: async () => evaluateBundleScan(OUTPUT_DIR),
};
