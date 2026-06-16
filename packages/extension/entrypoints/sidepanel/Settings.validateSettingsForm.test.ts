import { describe, expect, it } from "vitest";
import { validateSettingsForm } from "./Settings";

const VALID_MAPPING = JSON.stringify({
	title: { selector: 'input[name="title"]', fieldType: "text" },
});

describe("validateSettingsForm", () => {
	it("全空 → null（所有欄位空值跳過驗證）", () => {
		expect(
			validateSettingsForm({ endpoint: "", mappingText: "", backendUrl: "" }),
		).toBeNull();
	});

	it("https endpoint + localhost backendUrl → null", () => {
		expect(
			validateSettingsForm({
				endpoint: "https://api.example.com",
				mappingText: VALID_MAPPING,
				backendUrl: "http://localhost:3001",
			}),
		).toBeNull();
	});

	it("127.0.0.1 backendUrl → null", () => {
		expect(
			validateSettingsForm({
				endpoint: "",
				mappingText: "",
				backendUrl: "http://127.0.0.1:3001",
			}),
		).toBeNull();
	});

	it("http endpoint（非 https）→ 回傳 endpoint 錯誤", () => {
		expect(
			validateSettingsForm({
				endpoint: "http://example.com",
				mappingText: "",
				backendUrl: "",
			}),
		).toMatch(/https/i);
	});

	it("mappingText 非合法 JSON → 回傳 JSON 錯誤", () => {
		expect(
			validateSettingsForm({
				endpoint: "",
				mappingText: "not json",
				backendUrl: "",
			}),
		).toMatch(/JSON/i);
	});

	it("mappingText 合法 JSON 但 fieldType 非法 → 回傳錯誤", () => {
		expect(
			validateSettingsForm({
				endpoint: "",
				mappingText: JSON.stringify({
					title: { selector: "#x", fieldType: "bogus" },
				}),
				backendUrl: "",
			}),
		).toMatch(/fieldType/i);
	});

	it("remote backendUrl → 回傳 localhost 錯誤", () => {
		expect(
			validateSettingsForm({
				endpoint: "",
				mappingText: "",
				backendUrl: "https://remote.server.com",
			}),
		).toMatch(/localhost/i);
	});

	it("endpoint 非法 且 backendUrl 非法 → 回傳 endpoint 錯誤（endpoint 優先）", () => {
		const result = validateSettingsForm({
			endpoint: "http://example.com",
			mappingText: "",
			backendUrl: "https://remote.server.com",
		});
		expect(result).toMatch(/https/i);
		expect(result).not.toMatch(/localhost/i);
	});

	it("mappingText 空字串 → null（空值跳過驗證）", () => {
		expect(
			validateSettingsForm({
				endpoint: "https://api.example.com",
				mappingText: "",
				backendUrl: "",
			}),
		).toBeNull();
	});
});
