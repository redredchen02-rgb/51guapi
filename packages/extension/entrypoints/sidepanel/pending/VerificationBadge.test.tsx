// @vitest-environment jsdom
import type { VerificationResult } from "@51guapi/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VerificationBadge } from "./VerificationBadge";

afterEach(cleanup);

function vr(over: Partial<VerificationResult> = {}): VerificationResult {
	return {
		grounding: { perField: {}, unsourced: [], ok: true },
		validity: { ok: true, hardFail: false, qualityRatio: 1, reasons: [] },
		freshness: { ok: true, unknown: false, ageDays: 1 },
		fingerprint: "abc",
		decision: "pass",
		reasons: [],
		...over,
	};
}

describe("VerificationBadge", () => {
	it("无 verification 且无 verifiedAt → 不渲染", () => {
		const { container } = render(<VerificationBadge />);
		expect(container.firstChild).toBeNull();
	});

	it("pass → 验证通过", () => {
		render(<VerificationBadge verification={vr()} />);
		expect(screen.getByText(/验证通过/)).toBeTruthy();
	});

	it("flag + 未溯源 → 待核对 + 未溯源字段（文字编码,非纯色）", () => {
		render(
			<VerificationBadge
				verification={vr({
					decision: "flag",
					grounding: {
						perField: { 當事人: false },
						unsourced: ["當事人"],
						ok: false,
					},
					reasons: ["未溯源字段：當事人"],
				})}
			/>,
		);
		expect(screen.getByText(/待核对/)).toBeTruthy();
		expect(screen.getByText(/未溯源.*當事人/)).toBeTruthy();
	});

	it("时间未知", () => {
		render(
			<VerificationBadge
				verification={vr({
					freshness: { ok: true, unknown: true, ageDays: null },
				})}
			/>,
		);
		expect(screen.getByText(/时间未知/)).toBeTruthy();
	});

	it("疑似重复", () => {
		render(
			<VerificationBadge verification={vr({ suspectedDuplicate: true })} />,
		);
		expect(screen.getByText(/疑似重复/)).toBeTruthy();
	});

	it("verifiedAt → 已核对", () => {
		render(
			<VerificationBadge
				verification={vr()}
				verifiedAt="2026-06-18T00:00:00.000Z"
			/>,
		);
		expect(screen.getByText(/已核对/)).toBeTruthy();
	});
});
