import { describe, expect, it } from "vitest";
import { validateSettingsForm } from "./Settings";

describe("validateSettingsForm", () => {
	it("全空 → null（所有欄位空值跳過驗證）", () => {
		expect(validateSettingsForm({ endpoint: "", backendUrl: "" })).toBeNull();
	});

	it("https endpoint + localhost backendUrl → null", () => {
		expect(
			validateSettingsForm({
				endpoint: "https://api.example.com",
				backendUrl: "http://localhost:3002",
			}),
		).toBeNull();
	});

	it("127.0.0.1 backendUrl → null", () => {
		expect(
			validateSettingsForm({
				endpoint: "",
				backendUrl: "http://127.0.0.1:3002",
			}),
		).toBeNull();
	});

	it("http endpoint（非 https）→ 回傳 endpoint 錯誤", () => {
		const result = validateSettingsForm({
			endpoint: "http://example.com",
			backendUrl: "",
		});
		expect(result).toMatch(/https/i);
		expect(result).toMatch(/LLM_API_KEY/);
		expect(result).not.toMatch(/API key 会发往此处/);
	});

	it("endpoint 非法 且 backendUrl 非法 → 回傳 endpoint 錯誤（endpoint 優先）", () => {
		const result = validateSettingsForm({
			endpoint: "http://example.com",
			backendUrl: "https://remote.server.com",
		});
		expect(result).toMatch(/https/i);
		expect(result).not.toMatch(/localhost/i);
	});

	it("remote backendUrl → 回傳 localhost 錯誤", () => {
		expect(
			validateSettingsForm({
				endpoint: "",
				backendUrl: "https://remote.server.com",
			}),
		).toMatch(/localhost/i);
	});
});
