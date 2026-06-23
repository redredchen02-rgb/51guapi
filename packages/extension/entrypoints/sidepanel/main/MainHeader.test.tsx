// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainHeader } from "./MainHeader";

afterEach(() => cleanup());

function renderHeader() {
	return render(
		<MainHeader
			onOpenSettings={vi.fn()}
			onToggleLogs={vi.fn()}
			onOpenGossip={vi.fn()}
			onOpenPending={vi.fn()}
			onOpenMetrics={vi.fn()}
		/>,
	);
}

describe("MainHeader", () => {
	it("数据指标入口不再展示批次完成数", () => {
		renderHeader();

		expect(screen.getByText("抓取成功率、草稿生成率、验证关统计")).toBeTruthy();
		expect(screen.queryByText(/批次完成数/)).toBeNull();
	});
});
