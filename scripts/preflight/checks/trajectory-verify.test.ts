import { describe, expect, it } from "vitest";
import {
	appendRecord,
	type TrajectoryRecord,
	verifyTrajectory,
} from "../../../packages/extension/lib/trajectory.ts";
import { evaluateTrajectory } from "./trajectory-verify.ts";

describe("evaluateTrajectory", () => {
	it("好链通过 + 篡改/断裂被识别 → PASS", () => {
		expect(evaluateTrajectory().status).toBe("pass");
	});

	it("特征化:seq 断裂直接被 verifyTrajectory 判假", () => {
		let list: TrajectoryRecord[] = [];
		({ list } = appendRecord(list, {
			id: "a",
			topic: "t",
			fields: [],
			status: "x",
			ts: "2026-06-15T00:00:00.000Z",
		}));
		({ list } = appendRecord(list, {
			id: "b",
			topic: "t",
			fields: [],
			status: "x",
			ts: "2026-06-15T00:01:00.000Z",
		}));
		(list[1] as TrajectoryRecord).seq = 42;
		expect(verifyTrajectory(list)).toBe(false);
	});
});
