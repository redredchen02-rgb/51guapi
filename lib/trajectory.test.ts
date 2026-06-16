import { describe, expect, it } from "vitest";
import {
	appendRecord,
	buildRecord,
	rollbackTargets,
	type TrajectoryInput,
	type TrajectoryRecord,
	verifyTrajectory,
} from "./trajectory";

function input(over: Partial<TrajectoryInput> = {}): TrajectoryInput {
	return {
		id: "i1",
		topic: "番A",
		fields: [{ field: "title", status: "filled" }],
		status: "publish-confirmed",
		ts: "2026-06-04T00:00:00.000Z",
		...over,
	};
}

describe("trajectory", () => {
	it("append:seq 递增、hash 链接续", () => {
		let list: TrajectoryRecord[] = [];
		list = appendRecord(list, input({ id: "a" })).list;
		list = appendRecord(list, input({ id: "b" })).list;
		expect(list.map((r) => r.seq)).toEqual([1, 2]);
		expect(list[0]!.hash).not.toBe(list[1]!.hash);
		expect(verifyTrajectory(list)).toBe(true);
	});

	it("记录含字段 + URL + publishedAsDraft", () => {
		const { list } = appendRecord(
			[],
			input({ publishUrl: "/post/9", publishedAsDraft: true }),
		);
		expect(list[0]!.publishUrl).toBe("/post/9");
		expect(list[0]!.publishedAsDraft).toBe(true);
		expect(list[0]!.fields[0]!.field).toBe("title");
	});

	describe("脱敏闸门 fail-closed", () => {
		it("干净快照 → 存清洗结果", () => {
			const { list, snapshotDropped } = appendRecord(
				[],
				input({ rawSnapshot: '<input name="title" value="t">' }),
			);
			expect(snapshotDropped).toBe(false);
			expect(list[0]!.snapshot).toBeDefined();
			expect(list[0]!.snapshot).not.toMatch(/value="t"/); // 值被剥
		});

		it("含机密且清洗后仍残留 → 丢弃快照,record 仍落(不带 snapshot)", () => {
			const { list, snapshotDropped } = appendRecord(
				[],
				input({ rawSnapshot: "<span>PHPSESSID=deadbeefdeadbeef</span>" }),
			);
			expect(snapshotDropped).toBe(true);
			expect(list[0]!.snapshot).toBeUndefined();
			expect(list[0]!.status).toBe("publish-confirmed"); // 记录本身仍在
		});

		it("hidden value 含机密 → 被剥,快照可存", () => {
			const { list } = appendRecord(
				[],
				input({
					rawSnapshot:
						"<input type=hidden name=_token value=abcdef1234567890abcdef1234567890>",
				}),
			);
			expect(list[0]!.snapshot).toBeDefined();
			expect(list[0]!.snapshot).not.toMatch(/_token/);
		});
	});

	describe("篡改可检", () => {
		it("改某条字段 → verify 失败", () => {
			let list: TrajectoryRecord[] = [];
			list = appendRecord(list, input({ id: "a" })).list;
			list = appendRecord(list, input({ id: "b" })).list;
			const tampered = list.map((r, i) =>
				i === 0 ? { ...r, topic: "被改" } : r,
			);
			expect(verifyTrajectory(tampered)).toBe(false);
		});

		it("删中间一条(seq 断裂)→ verify 失败", () => {
			let list: TrajectoryRecord[] = [];
			for (const id of ["a", "b", "c"])
				list = appendRecord(list, input({ id })).list;
			const broken = [list[0]!, list[2]!]; // 删 seq=2
			expect(verifyTrajectory(broken)).toBe(false);
		});
	});

	it("rollbackTargets:仅 confirmed + 有 URL", () => {
		let list: TrajectoryRecord[] = [];
		list = appendRecord(list, input({ id: "a", publishUrl: "/post/1" })).list;
		list = appendRecord(
			list,
			input({ id: "b", status: "error", publishUrl: undefined }),
		).list;
		list = appendRecord(
			list,
			input({ id: "c", status: "publish-confirmed" }),
		).list; // 无 URL
		expect(rollbackTargets(list).map((r) => r.id)).toEqual(["a"]);
	});

	it("buildRecord 直接用:相同输入 + 链同 → 确定性 hash", () => {
		const a = buildRecord(input(), 1, "0").record;
		const b = buildRecord(input(), 1, "0").record;
		expect(a.hash).toBe(b.hash);
	});

	describe("Phase-2 度量字段携带", () => {
		it("mode 字段随 input 写入 record", () => {
			const { list } = appendRecord([], input({ mode: "authorized" }));
			expect(list[0]!.mode).toBe("authorized");
		});

		it("hasManualEdit 字段随 input 写入 record", () => {
			const { list } = appendRecord([], input({ hasManualEdit: true }));
			expect(list[0]!.hasManualEdit).toBe(true);
		});

		it("llmCostTokens 字段随 input 写入 record", () => {
			const { list } = appendRecord(
				[],
				input({ llmCostTokens: { prompt: 100, completion: 50 } }),
			);
			expect(list[0]!.llmCostTokens).toEqual({ prompt: 100, completion: 50 });
		});

		it("generationDurationMs 字段随 input 写入 record", () => {
			const { list } = appendRecord([], input({ generationDurationMs: 1500 }));
			expect(list[0]!.generationDurationMs).toBe(1500);
		});

		it("slotDiff 字段随 input 写入 record", () => {
			const slotDiff = { changedSlots: ["title", "body"], totalSlots: 10 };
			const { list } = appendRecord([], input({ slotDiff }));
			expect(list[0]!.slotDiff).toEqual(slotDiff);
		});

		it("度量字段均缺省时不出现在 record (undefined 不污染)", () => {
			const { list } = appendRecord([], input());
			expect(list[0]!.mode).toBeUndefined();
			expect(list[0]!.hasManualEdit).toBeUndefined();
			expect(list[0]!.llmCostTokens).toBeUndefined();
			expect(list[0]!.generationDurationMs).toBeUndefined();
			expect(list[0]!.slotDiff).toBeUndefined();
		});

		it("携带度量字段后 hash 链仍可验证", () => {
			let list: TrajectoryRecord[] = [];
			list = appendRecord(
				list,
				input({
					id: "a",
					mode: "authorized",
					llmCostTokens: { prompt: 10, completion: 5 },
				}),
			).list;
			list = appendRecord(
				list,
				input({
					id: "b",
					slotDiff: { changedSlots: ["title"], totalSlots: 10 },
				}),
			).list;
			expect(verifyTrajectory(list)).toBe(true);
		});
	});
});
