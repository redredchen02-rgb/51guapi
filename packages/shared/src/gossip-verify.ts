// 吃瓜爬取产物的「入池前验证关」：纯函数、无 I/O，可在 shared 复用。
// 在 from-url 的「gossipExtractFacts 后、savePendingTopic 前」对照**不可变 rawContent** 校验抽取结果。
// 四道检查：① 出处 grounding ② 有效性 ③ 新鲜度 ④ 内容指纹。
//
// 设计边界（务必理解，勿过度信任）：
// - grounding 只证「token 出处」(facts 的字符来自原文)，**非命题为真**。它挡得住「凭空捏造一个原文里
//   没有的人/事」，挡**不住**「把原文里一句真实但无关的话填进字段」——后者 token 都在原文，会通过。
//   事实真假核验(veracity)不在本关范围；facts 是信任根，人工二次核对兜底。
// - confidence(抽取填充比例)**不是**第四道检查、不参与硬拒；只作 score 输入。
// - 只有「明确无效」(空内容/错误页/广告/正文过短)触发 decision='reject'；质量比低/未溯源/时间未知/窗外
//   一律降级为 'flag'(入池带软标，人工决定)。内容指纹重复由 store 查库后按软标处理，本纯函数只产指纹。

import type { GossipFactsBlock } from "./gossip-facts.js";

export type VerifyDecision = "reject" | "flag" | "pass";

export interface VerifyInput {
	/** 抽取出的吃瓜事实。 */
	facts: GossipFactsBlock;
	/** 不可变原文纯文本（grounding 基准；调用方从 rawContent 提取纯文本传入）。 */
	rawText: string;
	/** 详情页解析出的发布时间（ISO 字符串）；缺失则 freshness.unknown=true。 */
	publishedTime?: string | null;
	/** 时间窗天数；未传/为 null 则不做窗口判定（退化为不按时间过滤）。 */
	windowDays?: number | null;
	/** 当前时间（ms epoch）。由调用方注入，便于测试与可复现（shared 内禁用 Date.now）。 */
	now: number;
}

export interface GroundingResult {
	/** 每个受检字段 → 是否溯源到原文。 */
	perField: Record<string, boolean>;
	/** 未溯源（present 但找不到出处）的字段名。 */
	unsourced: string[];
	/** 是否全部受检字段都溯源。 */
	ok: boolean;
}

export interface ValidityResult {
	/** 是否有效（!hardFail）。 */
	ok: boolean;
	/** 明确无效（空内容/错误页/广告/正文过短）→ 触发 reject。 */
	hardFail: boolean;
	/** 核心叙事键填充比例（抽取完整度，软信号，**严禁**据此硬拒）。 */
	qualityRatio: number;
	/** 说明。 */
	reasons: string[];
}

export interface FreshnessResult {
	/** 是否在时间窗内（无窗口判定时恒 true）。 */
	ok: boolean;
	/** 发布时间缺失（中性软标，不得据此 reject、不得享满分 freshness）。 */
	unknown: boolean;
	/** 距今天数；无法判定为 null。 */
	ageDays: number | null;
}

export interface VerificationResult {
	grounding: GroundingResult;
	validity: ValidityResult;
	freshness: FreshnessResult;
	/** 内容指纹（供调用方查库去重；本纯函数不查库）。 */
	fingerprint: string;
	decision: VerifyDecision;
	/** 人类可读的判定原因（用于 UI/日志）。 */
	reasons: string[];
}

const MS_PER_DAY = 86_400_000;

/** 正文纯文本长度下限（低于此视为空/无效页）。 */
const MIN_BODY_LEN = 80;

/** 明确无效页特征（错误页/占位/广告骨架）。实现期可据真实坏样本扩充。 */
const INVALID_MARKERS = [
	"404",
	"not found",
	"页面不存在",
	"頁面不存在",
	"page not found",
	"内容已删除",
	"內容已刪除",
	"访问被拒绝",
	"forbidden",
];

/** 受 grounding 校验的字段及其阈值（bigram 重叠率）。
 * 當事人=「谁」须强溯源(≈逐字出现)；叙事字段是 LLM 改写，宽松容忍 paraphrase。
 * 机械/推断字段(來源連結/發生時間/熱度標籤)不在 grounding 范围。 */
const GROUNDED_FIELDS: {
	key: keyof GossipFactsBlock;
	threshold: number;
	split: boolean;
}[] = [
	{ key: "當事人", threshold: 0.8, split: true },
	{ key: "事件摘要", threshold: 0.3, split: false },
	{ key: "起因", threshold: 0.3, split: false },
	{ key: "經過", threshold: 0.3, split: false },
	{ key: "結果", threshold: 0.3, split: false },
];

/** 核心叙事键（与 quality-gate 同口径；用于抽取完整度软信号）。 */
const CORE_NARRATIVE_KEYS: (keyof GossipFactsBlock)[] = [
	"當事人",
	"事件摘要",
	"起因",
	"經過",
	"結果",
];

/** 归一化：小写 + 去空白 + 去常见标点，让 grounding/指纹对排版/标点不敏感。 */
function norm(s: string): string {
	return s
		.toLowerCase()
		.replace(/\s+/g, "")
		.replace(
			/[，,、。.!！?？；;：:「」『』""''（）()[\]【】~`*#…—\-_/\\|]/g,
			"",
		);
}

/** 字符 bigram 列表（CJK 友好的轻量重叠度量）。 */
function bigrams(s: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
	return out;
}

/** value 的 bigram 有多少比例出现在已归一化的原文中（0..1）。 */
function overlapRatio(value: string, hayNorm: string): number {
	const v = norm(value);
	if (v.length === 0) return 1;
	if (v.length === 1) return hayNorm.includes(v) ? 1 : 0;
	const bg = bigrams(v);
	if (bg.length === 0) return 1;
	let present = 0;
	for (const g of bg) if (hayNorm.includes(g)) present++;
	return present / bg.length;
}

/** 稳定哈希（FNV-1a 32-bit，纯 JS、浏览器安全、跨端确定）。 */
function fnv1a(str: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * 内容指纹：归一化(當事人 + 事件摘要 + 起因 + 結果)的稳定哈希。
 * 基**放宽**到含起因/结果(非仅當事人+事件摘要)，避免同一名人不同事件因「人名+泛摘要」撞同指纹被误杀。
 */
export function computeContentFingerprint(facts: GossipFactsBlock): string {
	const basis = [facts.當事人, facts.事件摘要, facts.起因, facts.結果]
		.map((v) => norm(v ?? ""))
		.join("|");
	return fnv1a(basis);
}

/** 时间窗判定：在 [now - windowDays, now] 内？发布时间缺失返回 unknown。 */
export function isWithinWindow(
	publishedTime: string | null | undefined,
	windowDays: number | null | undefined,
	now: number,
): { ok: boolean; unknown: boolean; ageDays: number | null } {
	if (!publishedTime) return { ok: true, unknown: true, ageDays: null };
	const t = Date.parse(publishedTime);
	if (Number.isNaN(t)) return { ok: true, unknown: true, ageDays: null };
	const ageDays = Math.max(0, (now - t) / MS_PER_DAY);
	if (windowDays == null) return { ok: true, unknown: false, ageDays };
	return { ok: ageDays <= windowDays, unknown: false, ageDays };
}

function checkGrounding(
	facts: GossipFactsBlock,
	hayNorm: string,
): GroundingResult {
	const perField: Record<string, boolean> = {};
	const unsourced: string[] = [];
	for (const { key, threshold, split } of GROUNDED_FIELDS) {
		const raw = facts[key];
		if (raw == null || raw.trim().length === 0) continue; // 空字段不计入 grounding（由完整度软信号管）
		let grounded: boolean;
		if (split) {
			// 多值字段（如逗号分隔的人名）：每个 token 都须强溯源。
			const tokens = raw
				.split(/[,，、/]/)
				.map((t) => t.trim())
				.filter((t) => t.length > 0);
			grounded = tokens.every((tok) => overlapRatio(tok, hayNorm) >= threshold);
		} else {
			grounded = overlapRatio(raw, hayNorm) >= threshold;
		}
		perField[key] = grounded;
		if (!grounded) unsourced.push(key);
	}
	return { perField, unsourced, ok: unsourced.length === 0 };
}

function checkValidity(
	facts: GossipFactsBlock,
	rawText: string,
): ValidityResult {
	const reasons: string[] = [];
	const text = rawText ?? "";
	const trimmed = text.trim();
	let hardFail = false;

	if (trimmed.length < MIN_BODY_LEN) {
		hardFail = true;
		reasons.push(
			`正文过短(${trimmed.length}<${MIN_BODY_LEN})，疑空页/抓取失败`,
		);
	}
	const lower = trimmed.toLowerCase();
	const hit = INVALID_MARKERS.find((m) => lower.includes(m.toLowerCase()));
	if (hit) {
		hardFail = true;
		reasons.push(`命中无效页特征「${hit}」`);
	}

	const filled = CORE_NARRATIVE_KEYS.filter((k) => {
		const v = facts[k];
		return v != null && v.trim().length > 0;
	}).length;
	const qualityRatio = filled / CORE_NARRATIVE_KEYS.length;
	if (qualityRatio < 0.5) {
		reasons.push(
			`核心事实填充率仅 ${(qualityRatio * 100).toFixed(0)}%(软信号)`,
		);
	}

	return { ok: !hardFail, hardFail, qualityRatio, reasons };
}

/**
 * 入池前验证：四道检查 + 分级。基准 = 不可变 rawContent（每条重抽路径都应重跑）。
 * decision：仅 validity.hardFail → 'reject'；grounding 未溯源 / 质量比<0.5 / 时间未知 / 窗外 → 'flag'；否则 'pass'。
 * fail-closed：rawText 空或 facts 全空 → 绝不 'pass'。
 */
export function verifyCrawledTopic(input: VerifyInput): VerificationResult {
	const { facts, rawText, publishedTime, windowDays, now } = input;
	const hayNorm = norm(rawText ?? "");

	const grounding = checkGrounding(facts, hayNorm);
	const validity = checkValidity(facts, rawText ?? "");
	const fw = isWithinWindow(publishedTime, windowDays, now);
	const freshness: FreshnessResult = {
		ok: fw.ok,
		unknown: fw.unknown,
		ageDays: fw.ageDays,
	};
	const fingerprint = computeContentFingerprint(facts);

	const allFactsEmpty = GOSSIP_ALL_EMPTY(facts);

	const reasons: string[] = [];
	let decision: VerifyDecision;
	if (validity.hardFail) {
		decision = "reject";
		reasons.push(...validity.reasons);
	} else if (allFactsEmpty) {
		// fail-closed：内容看似有效但什么都没抽到 → 不静默 pass，交人工。
		decision = "flag";
		reasons.push("未抽到任何事实字段");
	} else {
		const flagReasons: string[] = [];
		if (!grounding.ok)
			flagReasons.push(`未溯源字段：${grounding.unsourced.join("、")}`);
		if (validity.qualityRatio < 0.5)
			flagReasons.push(
				`核心事实填充率 ${(validity.qualityRatio * 100).toFixed(0)}%`,
			);
		if (freshness.unknown) flagReasons.push("发布时间未知");
		if (!freshness.ok) flagReasons.push("超出时间窗");
		if (flagReasons.length > 0) {
			decision = "flag";
			reasons.push(...flagReasons);
		} else {
			decision = "pass";
		}
	}

	return { grounding, validity, freshness, fingerprint, decision, reasons };
}

function GOSSIP_ALL_EMPTY(facts: GossipFactsBlock): boolean {
	return CORE_NARRATIVE_KEYS.every((k) => {
		const v = facts[k];
		return v == null || v.trim().length === 0;
	});
}
