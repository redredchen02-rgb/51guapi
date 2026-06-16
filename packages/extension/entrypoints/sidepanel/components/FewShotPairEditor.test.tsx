// @vitest-environment jsdom

import type { FewShotPair } from "@51guapi/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FewShotPairEditor } from "./FewShotPairEditor";

function pair(input = "", output = ""): FewShotPair {
	return { input, output };
}

describe("FewShotPairEditor", () => {
	afterEach(cleanup);
	it("添加范例 → onChange 追加空卡片", () => {
		const onChange = vi.fn();
		render(<FewShotPairEditor pairs={[]} onChange={onChange} />);
		fireEvent.click(screen.getByText("+ 添加范例"));
		expect(onChange).toHaveBeenCalledWith([{ input: "", output: "" }]);
	});

	it("删除卡片 → onChange 缩短", () => {
		const onChange = vi.fn();
		render(
			<FewShotPairEditor
				pairs={[pair("A", "B"), pair("C", "D")]}
				onChange={onChange}
			/>,
		);
		const deleteBtns = screen.getAllByLabelText("删除");
		fireEvent.click(deleteBtns[0]!);
		expect(onChange).toHaveBeenCalledWith([{ input: "C", output: "D" }]);
	});

	it("8 张时「添加」按钮 disabled", () => {
		const pairs = Array.from({ length: 8 }, (_, i) => pair(`i${i}`, `o${i}`));
		render(<FewShotPairEditor pairs={pairs} onChange={vi.fn()} />);
		const btn = screen.getByRole("button", { name: /已达上限/ });
		expect((btn as HTMLButtonElement).disabled).toBe(true);
	});

	it("上移第一张 → 按钮 disabled", () => {
		render(
			<FewShotPairEditor
				pairs={[pair("A", "B"), pair("C", "D")]}
				onChange={vi.fn()}
			/>,
		);
		const upBtns = screen.getAllByLabelText("上移") as HTMLButtonElement[];
		expect(upBtns[0]?.disabled).toBe(true);
		expect(upBtns[1]?.disabled).toBe(false);
	});

	it("下移最后一张 → 按钮 disabled", () => {
		render(
			<FewShotPairEditor
				pairs={[pair("A", "B"), pair("C", "D")]}
				onChange={vi.fn()}
			/>,
		);
		const downBtns = screen.getAllByLabelText("下移") as HTMLButtonElement[];
		expect(downBtns[0]?.disabled).toBe(false);
		expect(downBtns[1]?.disabled).toBe(true);
	});

	it("导入 banner 存在时显示，点击后调 onImport", () => {
		const onImport = vi.fn();
		render(
			<FewShotPairEditor
				pairs={[]}
				onChange={vi.fn()}
				importBanner="检测到旧格式"
				onImport={onImport}
			/>,
		);
		expect(screen.getByText(/检测到旧格式/)).toBeTruthy();
		fireEvent.click(screen.getByText("导入"));
		expect(onImport).toHaveBeenCalledOnce();
	});

	it("无 importBanner 时不显示 banner", () => {
		render(<FewShotPairEditor pairs={[]} onChange={vi.fn()} />);
		expect(screen.queryByText("导入")).toBeNull();
	});

	it("上移第二张 → onChange 交换顺序", () => {
		const onChange = vi.fn();
		render(
			<FewShotPairEditor
				pairs={[pair("A", "B"), pair("C", "D")]}
				onChange={onChange}
			/>,
		);
		const upBtns = screen.getAllByLabelText("上移") as HTMLButtonElement[];
		fireEvent.click(upBtns[1]!); // 上移第二张
		expect(onChange).toHaveBeenCalledWith([
			{ input: "C", output: "D" },
			{ input: "A", output: "B" },
		]);
	});

	it("下移第一张 → onChange 交换顺序", () => {
		const onChange = vi.fn();
		render(
			<FewShotPairEditor
				pairs={[pair("A", "B"), pair("C", "D")]}
				onChange={onChange}
			/>,
		);
		const downBtns = screen.getAllByLabelText("下移") as HTMLButtonElement[];
		fireEvent.click(downBtns[0]!); // 下移第一张
		expect(onChange).toHaveBeenCalledWith([
			{ input: "C", output: "D" },
			{ input: "A", output: "B" },
		]);
	});
});
