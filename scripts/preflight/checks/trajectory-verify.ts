// green 检查:轨迹链 verifyTrajectory 真能识别完好链 / 篡改 / seq 断裂。
//
// trajectory.ts 是纯逻辑(无 #imports / chrome 依赖),可直接在 Node 引入。
// 构造一条好链(appendRecord 串起),断言 verify=true;
// 再制造 (a) seq 断裂 (b) hash 篡改,断言 verify=false。

import {
	appendRecord,
	type TrajectoryRecord,
	verifyTrajectory,
} from "../../../packages/extension/lib/trajectory.ts";
import type { CheckResult, GreenCheck } from "../types.ts";

function buildGoodChain(): TrajectoryRecord[] {
	let list: TrajectoryRecord[] = [];
	for (let i = 0; i < 3; i += 1) {
		({ list } = appendRecord(list, {
			id: `it_${i}`,
			topic: `topic ${i}`,
			fields: [],
			status: "publish-confirmed",
			ts: `2026-06-15T00:0${i}:00.000Z`,
		}));
	}
	return list;
}

export function evaluateTrajectory(): CheckResult {
	const good = buildGoodChain();
	if (!verifyTrajectory(good)) {
		return {
			status: "fail",
			reason: "完好链被误判为篡改(verifyTrajectory 假阴)。",
		};
	}

	// (a) seq 断裂:把中间一条 seq 改掉。
	const gap = good.map((r) => ({ ...r }));
	(gap[1] as TrajectoryRecord).seq = 99;
	if (verifyTrajectory(gap)) {
		return {
			status: "fail",
			reason: "seq 断裂的链未被识别(verifyTrajectory 假阳)。",
		};
	}

	// (b) hash 篡改:改内容但不重算 hash。
	const tampered = good.map((r) => ({ ...r }));
	(tampered[2] as TrajectoryRecord).topic = "TAMPERED";
	if (verifyTrajectory(tampered)) {
		return {
			status: "fail",
			reason: "被篡改内容的链未被识别(verifyTrajectory 假阳)。",
		};
	}

	return {
		status: "pass",
		reason: "verifyTrajectory:好链通过,seq 断裂与内容篡改均被识别。",
	};
}

export const trajectoryVerifyCheck: GreenCheck = {
	id: "trajectory-verify",
	label: "轨迹 hash 链完整性可检",
	tier: "green",
	run: async () => evaluateTrajectory(),
};
