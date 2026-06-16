// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
	afterEach(cleanup);

	it("renders with correct progress", () => {
		render(<ProgressBar progress={50} />);
		const el = screen.getByRole("progressbar");
		expect(el.getAttribute("aria-valuenow")).toBe("50");
	});

	it("renders with 0 progress", () => {
		render(<ProgressBar progress={0} />);
		const el = screen.getByRole("progressbar");
		expect(el.getAttribute("aria-valuenow")).toBe("0");
	});

	it("renders with 100 progress", () => {
		render(<ProgressBar progress={100} />);
		const el = screen.getByRole("progressbar");
		expect(el.getAttribute("aria-valuenow")).toBe("100");
	});
});
