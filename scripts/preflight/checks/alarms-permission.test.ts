import { describe, expect, it } from "vitest";
import { evaluateAlarms, parsePermissions } from "./alarms-permission.ts";

const WITH = `permissions: ["storage", "sidePanel", "alarms"],`;
const WITHOUT = `permissions: ["storage", "sidePanel"],`;

describe("evaluateAlarms（特征化:缺 alarms 判红）", () => {
	it("含 alarms → PASS", () => {
		expect(evaluateAlarms(WITH).status).toBe("pass");
	});

	it("缺 alarms → RED 并指明", () => {
		const r = evaluateAlarms(WITHOUT);
		expect(r.status).toBe("fail");
		expect(r.reason).toContain("alarms");
	});

	it("parsePermissions 提取数组", () => {
		expect(parsePermissions(WITH)).toEqual(["storage", "sidePanel", "alarms"]);
	});
});
