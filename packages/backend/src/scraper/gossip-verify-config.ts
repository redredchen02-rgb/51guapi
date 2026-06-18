// 验证关阈值的 env 注入层(plan 004 followup)。
// shared/gossip-verify.ts 是纯包、浏览器安全,绝不读 process.env;由此处(后端)在
// **调用时**读 env 并注入 VerifyConfig,保持纯净。所有 env 在 call time 读取(非 import 时),
// 与 ssrf-allowlist 同纪律,便于测试/热改。全部可选;未设即用 shared 内置默认。
import type { VerifyConfig } from "@51guapi/shared";

function numEnv(key: string): number | undefined {
	const raw = process.env[key];
	if (raw == null || raw.trim() === "") return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

/** 从 env 组装验证关阈值覆盖(只含已设的键)。 */
export function loadVerifyConfig(): VerifyConfig {
	const cfg: VerifyConfig = {};
	const minBodyLen = numEnv("GOSSIP_MIN_BODY_LEN");
	if (minBodyLen !== undefined) cfg.minBodyLen = minBodyLen;
	const qualityRatio = numEnv("GOSSIP_QUALITY_RATIO");
	if (qualityRatio !== undefined) cfg.qualityRatioThreshold = qualityRatio;
	const nameThreshold = numEnv("GOSSIP_NAME_THRESHOLD");
	if (nameThreshold !== undefined) cfg.nameThreshold = nameThreshold;
	const narrativeThreshold = numEnv("GOSSIP_NARRATIVE_THRESHOLD");
	if (narrativeThreshold !== undefined)
		cfg.narrativeThreshold = narrativeThreshold;
	const markers = process.env.GOSSIP_INVALID_MARKERS;
	if (markers?.trim()) {
		cfg.invalidMarkers = markers
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	}
	return cfg;
}

/** 解析有效时间窗:请求显式传入优先;否则回退 env 默认;都没有 → undefined(不按时间过滤)。 */
export function resolveWindowDays(
	requested?: number | null,
): number | undefined {
	if (requested != null) return requested;
	return numEnv("GOSSIP_WINDOW_DAYS_DEFAULT");
}
