import { describe, expect, it } from "vitest";
import { aggregate, render } from "./runner.ts";
import type { GreenCheck, RedResidual } from "./types.ts";

const RED: RedResidual = {
	id: "manual-thing",
	label: "人工冒烟",
	tier: "red",
	note: "代码无法替你验证。",
};

function green(id: string, status: "pass" | "fail"): GreenCheck {
	return {
		id,
		label: id,
		tier: "green",
		run: async () => ({ status, reason: `${id} ${status}` }),
	};
}

describe("aggregate", () => {
	it("happy:全 green pass + red 列出 → exit0,reds 出现", async () => {
		const s = await aggregate([green("a", "pass"), green("b", "pass")], [RED]);
		expect(s.ok).toBe(true);
		expect(s.exitCode).toBe(0);
		expect(s.reds).toHaveLength(1);
		const out = render(s);
		expect(out).toContain("人工冒烟");
		expect(out).toContain("Preflight 通过");
	});

	it("edge:空 green 集 → 判红(防假绿)", async () => {
		const s = await aggregate([], [RED]);
		expect(s.ok).toBe(false);
		expect(s.exitCode).not.toBe(0);
		expect(s.failReason).toContain("零 green 目标");
	});

	it("error:某 green run 抛异常 → fail + reason,整体判红", async () => {
		const throwing: GreenCheck = {
			id: "boom",
			label: "boom",
			tier: "green",
			run: async () => {
				throw new Error("内部炸了");
			},
		};
		const s = await aggregate([green("a", "pass"), throwing], [RED]);
		expect(s.ok).toBe(false);
		expect(s.exitCode).not.toBe(0);
		const boom = s.greens.find((g) => g.id === "boom");
		expect(boom?.status).toBe("fail");
		expect(boom?.reason).toContain("内部炸了");
	});

	it("edge:只有 reds、无 greens → 判红 + reds 标记未完成", async () => {
		const s = await aggregate([], [RED]);
		expect(s.ok).toBe(false);
		const out = render(s);
		expect(out).toContain("NOT DONE");
		expect(out).toContain("人工冒烟");
	});

	it("任一 green fail → 判红", async () => {
		const s = await aggregate([green("a", "pass"), green("b", "fail")], [RED]);
		expect(s.ok).toBe(false);
		expect(s.exitCode).not.toBe(0);
	});
});
