import type { GossipFactsBlock } from "@51guapi/shared";
import {
	computeContentFingerprint,
	isWithinWindow,
	verifyCrawledTopic,
} from "@51guapi/shared";
import { describe, expect, it } from "vitest";

// 一篇真实感的吃瓜原文（>80 字，含「周杰倫」「蔡依林」）。
const RAW =
	"據知情人爆料，藝人周杰倫與蔡依林近日傳出合作消息。起因是兩人在頒獎典禮同台，現場互動熱絡。" +
	"經紀公司回應稱純屬工作交流，並未證實戀情。網友紛紛吃瓜圍觀，話題迅速登上熱搜。";

const NOW = Date.parse("2026-06-18T00:00:00Z");

function makeFacts(
	overrides: Partial<GossipFactsBlock> = {},
): GossipFactsBlock {
	return {
		當事人: "周杰倫,蔡依林",
		事件摘要: "周杰倫與蔡依林傳出合作消息",
		起因: "兩人在頒獎典禮同台",
		經過: "現場互動熱絡",
		結果: "經紀公司回應純屬工作交流",
		來源連結: "https://51cg1.com/post/123",
		發生時間: "2024-05",
		熱度標籤: "合作,緋聞",
		...overrides,
	};
}

describe("verifyCrawledTopic", () => {
	it("各字段溯源、正文充足、质量达标、窗内 → pass", () => {
		const r = verifyCrawledTopic({
			facts: makeFacts(),
			rawText: RAW,
			publishedTime: "2026-06-15",
			windowDays: 7,
			now: NOW,
		});
		expect(r.grounding.ok).toBe(true);
		expect(r.validity.hardFail).toBe(false);
		expect(r.freshness.ok).toBe(true);
		expect(r.freshness.unknown).toBe(false);
		expect(r.decision).toBe("pass");
	});

	it("grounding 局限：填入原文里真实但任意的句子仍判溯源(记录已知弱点)", () => {
		// 結果 填的是原文里真实存在、但语义上未必对应「結果」的句子；子串/重叠法无法分辨字段错配。
		const r = verifyCrawledTopic({
			facts: makeFacts({ 結果: "網友紛紛吃瓜圍觀" }),
			rawText: RAW,
			publishedTime: "2026-06-15",
			windowDays: 7,
			now: NOW,
		});
		expect(r.grounding.perField.結果).toBe(true); // 局限：token 都在原文 → 判溯源
		expect(r.decision).toBe("pass");
	});

	it("凭空捏造原文没有的人 → 該字段未溯源 → flag", () => {
		const r = verifyCrawledTopic({
			facts: makeFacts({ 當事人: "林志玲" }), // 原文无此人
			rawText: RAW,
			publishedTime: "2026-06-15",
			windowDays: 7,
			now: NOW,
		});
		expect(r.grounding.perField.當事人).toBe(false);
		expect(r.grounding.unsourced).toContain("當事人");
		expect(r.decision).toBe("flag");
	});

	it("整段编造的叙事字段(token 几乎不在原文) → 未溯源 → flag", () => {
		const r = verifyCrawledTopic({
			facts: makeFacts({ 結果: "雙方閃電結婚並移民火星定居" }),
			rawText: RAW,
			publishedTime: "2026-06-15",
			windowDays: 7,
			now: NOW,
		});
		expect(r.grounding.perField.結果).toBe(false);
		expect(r.decision).toBe("flag");
	});

	it("正文过短 → 硬拒 reject", () => {
		const r = verifyCrawledTopic({
			facts: makeFacts(),
			rawText: "太短了",
			publishedTime: "2026-06-15",
			windowDays: 7,
			now: NOW,
		});
		expect(r.validity.hardFail).toBe(true);
		expect(r.decision).toBe("reject");
	});

	it("命中错误页特征(404/not found) → 硬拒 reject", () => {
		const r = verifyCrawledTopic({
			facts: makeFacts(),
			rawText:
				"404 Not Found。您訪問的頁面不存在或已被刪除，請返回首頁繼續瀏覽其他內容看看別的吧。",
			publishedTime: "2026-06-15",
			windowDays: 7,
			now: NOW,
		});
		expect(r.validity.hardFail).toBe(true);
		expect(r.decision).toBe("reject");
	});

	it("质量比低但内容有效 → flag(非 reject)", () => {
		const r = verifyCrawledTopic({
			// 只有當事人填了(且溯源)，其余核心字段 null → 填充率 0.2
			facts: makeFacts({
				事件摘要: null,
				起因: null,
				經過: null,
				結果: null,
			}),
			rawText: RAW,
			publishedTime: "2026-06-15",
			windowDays: 7,
			now: NOW,
		});
		expect(r.validity.hardFail).toBe(false);
		expect(r.validity.qualityRatio).toBeCloseTo(0.2, 5);
		expect(r.decision).toBe("flag");
	});

	it("超出时间窗 → freshness.ok=false → flag", () => {
		const r = verifyCrawledTopic({
			facts: makeFacts(),
			rawText: RAW,
			publishedTime: "2026-01-01", // 距 2026-06-18 远超 7 天
			windowDays: 7,
			now: NOW,
		});
		expect(r.freshness.ok).toBe(false);
		expect(r.freshness.unknown).toBe(false);
		expect(r.decision).toBe("flag");
	});

	it("发布时间缺失 → unknown=true 中性软标(不 reject、不享满分)", () => {
		const r = verifyCrawledTopic({
			facts: makeFacts(),
			rawText: RAW,
			publishedTime: null,
			windowDays: 7,
			now: NOW,
		});
		expect(r.freshness.unknown).toBe(true);
		expect(r.freshness.ageDays).toBeNull();
		expect(r.decision).toBe("flag");
	});

	it("fail-closed：空原文 → 绝不 pass(reject)", () => {
		const r = verifyCrawledTopic({
			facts: makeFacts(),
			rawText: "",
			publishedTime: "2026-06-15",
			windowDays: 7,
			now: NOW,
		});
		expect(r.decision).toBe("reject");
	});

	it("fail-closed：正文有效但 facts 全空 → 绝不 pass(flag)", () => {
		const empty: GossipFactsBlock = {
			當事人: null,
			事件摘要: null,
			起因: null,
			經過: null,
			結果: null,
			來源連結: null,
			發生時間: null,
			熱度標籤: null,
		};
		const r = verifyCrawledTopic({
			facts: empty,
			rawText: RAW,
			publishedTime: "2026-06-15",
			windowDays: 7,
			now: NOW,
		});
		expect(r.decision).toBe("flag");
		expect(r.reasons.join()).toContain("未抽到");
	});

	it("windowDays 未传 → 不按时间过滤(有日期也 ok)", () => {
		const r = verifyCrawledTopic({
			facts: makeFacts(),
			rawText: RAW,
			publishedTime: "2020-01-01",
			windowDays: null,
			now: NOW,
		});
		expect(r.freshness.ok).toBe(true);
		expect(r.freshness.unknown).toBe(false);
		expect(r.decision).toBe("pass");
	});
});

describe("computeContentFingerprint", () => {
	it("同一瓜(facts 相同)→ 同指纹(供跨 URL 去重)", () => {
		const a = computeContentFingerprint(makeFacts());
		const b = computeContentFingerprint(makeFacts());
		expect(a).toBe(b);
	});

	it("同一名人不同事件 → 不同指纹(放宽指纹基,避免误杀)", () => {
		const ev1 = computeContentFingerprint(
			makeFacts({
				當事人: "周杰倫",
				事件摘要: "演唱會延期",
				起因: "嗓子發炎",
				結果: "改期",
			}),
		);
		const ev2 = computeContentFingerprint(
			makeFacts({
				當事人: "周杰倫",
				事件摘要: "新歌發布",
				起因: "專輯企劃",
				結果: "登頂榜單",
			}),
		);
		expect(ev1).not.toBe(ev2);
	});

	it("指纹只看内容、与 URL 无关", () => {
		const a = computeContentFingerprint(
			makeFacts({ 來源連結: "https://51cg1.com/a" }),
		);
		const b = computeContentFingerprint(
			makeFacts({ 來源連結: "https://other.com/b" }),
		);
		expect(a).toBe(b);
	});

	it("可指定指纹字段集 → 默认忽略的字段(經過)纳入后区分原本同指纹的两条", () => {
		const base = makeFacts({ 經過: "現場互動熱絡" });
		const diffOnlyPassage = makeFacts({ 經過: "全程零互動" });
		// 默认基(不含經過)→ 两条同指纹
		expect(computeContentFingerprint(base)).toBe(
			computeContentFingerprint(diffOnlyPassage),
		);
		// 把經過纳入基 → 两条区分开
		const fields = ["當事人", "事件摘要", "起因", "經過", "結果"] as const;
		expect(computeContentFingerprint(base, [...fields])).not.toBe(
			computeContentFingerprint(diffOnlyPassage, [...fields]),
		);
	});

	it("字段顺序变化也会改指纹(按传入顺序拼接)", () => {
		const f = makeFacts();
		expect(computeContentFingerprint(f, ["當事人", "事件摘要"])).not.toBe(
			computeContentFingerprint(f, ["事件摘要", "當事人"]),
		);
	});
});

describe("verifyCrawledTopic — config.fingerprintFields", () => {
	it("config 注入字段集 → 指纹随基改变,且与直接调用一致", () => {
		const facts = makeFacts();
		const fields = ["當事人", "事件摘要"] as const;
		const r = verifyCrawledTopic({
			facts,
			rawText: RAW,
			now: NOW,
			config: { fingerprintFields: [...fields] },
		});
		expect(r.fingerprint).toBe(computeContentFingerprint(facts, [...fields]));
		// 与默认基不同(默认含起因/结果)
		expect(r.fingerprint).not.toBe(computeContentFingerprint(facts));
	});
});

describe("isWithinWindow", () => {
	it("窗内 → ok", () => {
		expect(isWithinWindow("2026-06-15", 7, NOW)).toEqual({
			ok: true,
			unknown: false,
			ageDays: expect.any(Number),
		});
	});
	it("窗外 → !ok", () => {
		expect(isWithinWindow("2026-01-01", 7, NOW).ok).toBe(false);
	});
	it("缺失/无法解析 → unknown", () => {
		expect(isWithinWindow(null, 7, NOW).unknown).toBe(true);
		expect(isWithinWindow("not-a-date", 7, NOW).unknown).toBe(true);
	});
	it("无 windowDays → 不判窗(ok 恒 true)", () => {
		expect(isWithinWindow("2000-01-01", null, NOW).ok).toBe(true);
	});
});

describe("verifyCrawledTopic — config 阈值覆盖", () => {
	const base = {
		facts: makeFacts(),
		rawText: RAW,
		publishedTime: "2026-06-15",
		windowDays: 7,
		now: NOW,
	};

	it("minBodyLen 调小 → 短正文不再硬拒", () => {
		const short = { ...base, rawText: "短短短" };
		expect(verifyCrawledTopic(short).decision).toBe("reject"); // 默认 80
		expect(
			verifyCrawledTopic({ ...short, config: { minBodyLen: 2 } }).validity
				.hardFail,
		).toBe(false);
	});

	it("minBodyLen 调大 → 正常正文被硬拒", () => {
		const r = verifyCrawledTopic({ ...base, config: { minBodyLen: 100000 } });
		expect(r.validity.hardFail).toBe(true);
		expect(r.decision).toBe("reject");
	});

	it("qualityRatioThreshold 调小 → 低填充率不再软标(可达 pass)", () => {
		// 只填 當事人+事件摘要(均溯源)→ 填充率 0.4
		const sparse = {
			...base,
			facts: makeFacts({ 起因: null, 經過: null, 結果: null }),
		};
		expect(verifyCrawledTopic(sparse).decision).toBe("flag"); // 默认 0.5 → 0.4 触发软标
		expect(
			verifyCrawledTopic({ ...sparse, config: { qualityRatioThreshold: 0.3 } })
				.decision,
		).toBe("pass");
	});

	it("narrativeThreshold 调高 → 叙事字段判未溯源", () => {
		expect(verifyCrawledTopic(base).grounding.perField.事件摘要).toBe(true);
		expect(
			verifyCrawledTopic({ ...base, config: { narrativeThreshold: 0.99 } })
				.grounding.perField.事件摘要,
		).toBe(false);
	});

	it("invalidMarkers 覆盖 → 命中自定义无效特征即硬拒", () => {
		const withMarker = { ...base, rawText: `${RAW} 敏感词屏蔽` };
		expect(verifyCrawledTopic(withMarker).validity.hardFail).toBe(false);
		expect(
			verifyCrawledTopic({
				...withMarker,
				config: { invalidMarkers: ["敏感词屏蔽"] },
			}).decision,
		).toBe("reject");
	});
});
