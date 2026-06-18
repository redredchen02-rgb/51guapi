import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadVerifyConfig, resolveWindowDays } from "./gossip-verify-config.js";

const KEYS = [
	"GOSSIP_MIN_BODY_LEN",
	"GOSSIP_QUALITY_RATIO",
	"GOSSIP_NAME_THRESHOLD",
	"GOSSIP_NARRATIVE_THRESHOLD",
	"GOSSIP_INVALID_MARKERS",
	"GOSSIP_WINDOW_DAYS_DEFAULT",
	"GOSSIP_FINGERPRINT_FIELDS",
];

function clearEnv() {
	for (const k of KEYS) delete process.env[k];
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("loadVerifyConfig", () => {
	it("无 env → 空对象(全用 shared 默认)", () => {
		expect(loadVerifyConfig()).toEqual({});
	});

	it("数值 env 被解析进 config", () => {
		process.env.GOSSIP_MIN_BODY_LEN = "40";
		process.env.GOSSIP_QUALITY_RATIO = "0.3";
		process.env.GOSSIP_NAME_THRESHOLD = "0.9";
		process.env.GOSSIP_NARRATIVE_THRESHOLD = "0.2";
		expect(loadVerifyConfig()).toEqual({
			minBodyLen: 40,
			qualityRatioThreshold: 0.3,
			nameThreshold: 0.9,
			narrativeThreshold: 0.2,
		});
	});

	it("非法/空数值 env → 忽略(不进 config)", () => {
		process.env.GOSSIP_MIN_BODY_LEN = "abc";
		process.env.GOSSIP_QUALITY_RATIO = "   ";
		expect(loadVerifyConfig()).toEqual({});
	});

	it("invalidMarkers 逗号分隔 → 去空白数组", () => {
		process.env.GOSSIP_INVALID_MARKERS = "404, 页面不存在 ,, gone";
		expect(loadVerifyConfig().invalidMarkers).toEqual([
			"404",
			"页面不存在",
			"gone",
		]);
	});

	it("env 在 call time 读取(改了立刻生效)", () => {
		expect(loadVerifyConfig().minBodyLen).toBeUndefined();
		process.env.GOSSIP_MIN_BODY_LEN = "10";
		expect(loadVerifyConfig().minBodyLen).toBe(10);
	});

	it("fingerprintFields 逗号分隔 → 白名单内字段数组", () => {
		process.env.GOSSIP_FINGERPRINT_FIELDS = "當事人, 事件摘要 , 經過";
		expect(loadVerifyConfig().fingerprintFields).toEqual([
			"當事人",
			"事件摘要",
			"經過",
		]);
	});

	it("fingerprintFields 滤掉白名单外的非法键", () => {
		process.env.GOSSIP_FINGERPRINT_FIELDS = "當事人,來源連結,熱度標籤,起因";
		expect(loadVerifyConfig().fingerprintFields).toEqual(["當事人", "起因"]);
	});

	it("fingerprintFields 全非法 → 不进 config(回退默认)", () => {
		process.env.GOSSIP_FINGERPRINT_FIELDS = "foo, 來源連結";
		expect(loadVerifyConfig().fingerprintFields).toBeUndefined();
	});
});

describe("resolveWindowDays", () => {
	it("请求显式值优先", () => {
		process.env.GOSSIP_WINDOW_DAYS_DEFAULT = "30";
		expect(resolveWindowDays(7)).toBe(7);
	});
	it("请求缺省 → 回退 env 默认", () => {
		process.env.GOSSIP_WINDOW_DAYS_DEFAULT = "30";
		expect(resolveWindowDays(undefined)).toBe(30);
		expect(resolveWindowDays(null)).toBe(30);
	});
	it("都没有 → undefined(不过滤)", () => {
		expect(resolveWindowDays(undefined)).toBeUndefined();
	});
});
