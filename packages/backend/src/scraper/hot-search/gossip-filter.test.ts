import { describe, expect, it } from "vitest";
import { isGossipOrEntertainment } from "./gossip-filter.js";

describe("gossip-filter", () => {
	it("应该保留合法的娱乐八卦和名人/明星吃瓜词汇", () => {
		expect(isGossipOrEntertainment("章子怡汪峰离婚")).toBe(true);
		expect(isGossipOrEntertainment("王力宏回应李靓蕾")).toBe(true);
		expect(isGossipOrEntertainment("某明星演唱会假唱风波")).toBe(true);
		expect(isGossipOrEntertainment("张三嫖娼被抓")).toBe(true);
		expect(isGossipOrEntertainment("顶流小生恋情曝光")).toBe(true);
	});

	it("应该过滤掉政治与政府相关词汇", () => {
		expect(isGossipOrEntertainment("外交部回应美方制裁")).toBe(false);
		expect(isGossipOrEntertainment("习近平主持召开中央政治局会议")).toBe(false);
		expect(isGossipOrEntertainment("拜登宣布退选")).toBe(false);
		expect(isGossipOrEntertainment("第十四届全国人大代表大会")).toBe(false);
	});

	it("应该过滤掉宏观经济与金融相关词汇", () => {
		expect(isGossipOrEntertainment("A股跌破3000点")).toBe(false);
		expect(isGossipOrEntertainment("多地房贷利率下调")).toBe(false);
		expect(isGossipOrEntertainment("国家统计局发布第一季度GDP")).toBe(false);
		expect(isGossipOrEntertainment("股市涨停潮")).toBe(false);
	});

	it("应该过滤掉体育比赛比分、赛事结果和常规新闻", () => {
		expect(isGossipOrEntertainment("国乒男团3比0击败韩国夺冠")).toBe(false);
		expect(isGossipOrEntertainment("NBA季后赛湖人战胜勇士")).toBe(false);
		expect(isGossipOrEntertainment("世预赛国足大名单公布")).toBe(false);
		expect(isGossipOrEntertainment("阿根廷晋级美洲杯决赛")).toBe(false);
	});

	it("应该过滤掉自然灾害、恶劣天气与公共安全事故", () => {
		expect(isGossipOrEntertainment("四川宜宾发生4.5级地震")).toBe(false);
		expect(isGossipOrEntertainment("台风格美即将在福建登陆")).toBe(false);
		expect(isGossipOrEntertainment("中央气象台发布暴雨黄色预警")).toBe(false);
		expect(isGossipOrEntertainment("某地高速路段发生连环车祸")).toBe(false);
	});

	it("应该过滤掉军事与航天相关词汇", () => {
		expect(isGossipOrEntertainment("神舟十八号发射圆满成功")).toBe(false);
		expect(isGossipOrEntertainment("我国成功发射一箭多星")).toBe(false);
		expect(isGossipOrEntertainment("东部战区位台岛周边开展联合演训")).toBe(
			false,
		);
	});

	it("应该过滤掉教育考试与学术相关词汇", () => {
		expect(
			isGossipOrEntertainment("2026年全国硕士研究生招生考试国家线公布"),
		).toBe(false);
		expect(isGossipOrEntertainment("多省公布高考分数线")).toBe(false);
	});
});
