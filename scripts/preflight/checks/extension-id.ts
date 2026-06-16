// 从扩展公钥派生稳定扩展 ID(Chrome 算法)。
//
// 算法:base64-decode 公钥 → SHA-256 DER 字节 → 取前 16 字节 →
// 每个字节拆成两个 nibble(高位在前)→ 每个 nibble 0..15 映射到 a..p →
// 得到 32 字符的扩展 id。
//
// 公钥非机密(已入库于 wxt.config.ts),此处仅做派生,不接触私钥。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 单一来源:公钥只存在于 packages/extension/wxt.config.ts。此处运行时读取,
// 不复制字面量 —— 既避免公钥轮换后的静默漂移,也不让 base64 公钥再被
// gitleaks 误判为机密(避免在本脚本中重复出现密钥状字符串)。

/** 从 wxt.config.ts 解析 EXTENSION_KEY 默认值;允许 env 覆盖(与 wxt 自身逻辑一致)。 */
function resolveExtensionKey(): string {
	const fromEnv = process.env.EXTENSION_KEY?.trim();
	if (fromEnv) return fromEnv;
	const wxtConfigPath = fileURLToPath(
		new URL("../../../packages/extension/wxt.config.ts", import.meta.url),
	);
	const src = readFileSync(wxtConfigPath, "utf8");
	// 匹配 `const EXTENSION_KEY = process.env... ?? "<base64>"` 中的 base64 默认值。
	const m = src.match(/EXTENSION_KEY\s*=[\s\S]*?"([A-Za-z0-9+/=]{200,})"/);
	if (!m?.[1]) {
		throw new Error(
			`无法从 ${wxtConfigPath} 解析 EXTENSION_KEY —— wxt.config.ts 结构可能已变,preflight 的扩展 id 派生失效。`,
		);
	}
	return m[1];
}

/** wxt.config.ts 中固定的 EXTENSION_KEY(base64 公钥),运行时读取。 */
export const EXTENSION_KEY = resolveExtensionKey();

/** 文档记录的已知 ID(用于交叉校验,见 wxt.config.ts 注释)。 */
export const KNOWN_EXTENSION_ID = "iljimdgfajpgnmanklehhmapojbcjecd";

/** 从 base64 公钥派生扩展 ID。 */
export function deriveExtensionId(base64Key: string): string {
	const der = Buffer.from(base64Key, "base64");
	const digest = createHash("sha256").update(der).digest();
	let id = "";
	for (let i = 0; i < 16; i += 1) {
		const byte = digest[i] as number;
		const hi = byte >> 4;
		const lo = byte & 0x0f;
		id += String.fromCharCode(97 + hi);
		id += String.fromCharCode(97 + lo);
	}
	return id;
}

/** 完整 chrome-extension:// 来源。 */
export function deriveExtensionOrigin(base64Key: string): string {
	return `chrome-extension://${deriveExtensionId(base64Key)}`;
}
