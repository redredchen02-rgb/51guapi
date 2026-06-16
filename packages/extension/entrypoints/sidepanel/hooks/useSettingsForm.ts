import type { FewShotPair, FieldMapping } from "@51guapi/shared";
import { useCallback, useRef, useState } from "react";
import type { ConnectionTestResult } from "../../../lib/connection-test";
import { testConnection as runTestConnection } from "../../../lib/connection-test";
import type { PromptTemplate } from "../../../lib/prompt-client";
import { createPrompt, fetchPrompts } from "../../../lib/prompt-client";
import {
	deriveFewShotExamples,
	getSettings,
	saveApiKey,
	saveBackendToken,
	saveSettings,
	getApiKey as storageGetApiKey,
	getBackendToken as storageGetBackendToken,
} from "../../../lib/storage";
import { parseTagsText, validateSettingsForm } from "../Settings";

export interface SettingsFormValues {
	endpoint: string;
	model: string;
	promptTemplate: string;
	fewShotPairs: FewShotPair[];
	tagsText: string;
	mappingText: string;
	fallbackModel: string;
	backendUrl: string;
	reviewCriteriaPrompt: string;
	dailyBatchSize: string;
}

export interface UseSettingsFormReturn {
	formValues: SettingsFormValues;
	getApiKey: () => string;
	getBackendToken: () => string;
	setApiKey: (v: string) => void;
	setBackendToken: (v: string) => void;
	derivedFewShotExamples: string;
	prompts: PromptTemplate[];
	selectedPromptId: string;
	promptStatus: string;
	load: () => Promise<void>;
	save: () => Promise<string | null>;
	loadPrompts: () => Promise<void>;
	selectPrompt: (id: string) => void;
	savePromptToBackend: (name: string) => Promise<void>;
	testConnectionFn: () => Promise<ConnectionTestResult>;
	setFormValue: <K extends keyof SettingsFormValues>(
		key: K,
		value: SettingsFormValues[K],
	) => void;
	setFewShotPairs: (pairs: FewShotPair[]) => void;
}

export function useSettingsForm(): UseSettingsFormReturn {
	const [formValues, setFormValues] = useState<SettingsFormValues>({
		endpoint: "",
		model: "",
		promptTemplate: "",
		fewShotPairs: [],
		tagsText: "",
		mappingText: "",
		fallbackModel: "",
		backendUrl: "",
		reviewCriteriaPrompt: "",
		dailyBatchSize: "5",
	});

	const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
	const [selectedPromptId, setSelectedPromptId] = useState("");
	const [promptStatus, setPromptStatus] = useState("");

	const apiKeyRef = useRef("");
	const backendTokenRef = useRef("");
	const loadedRef = useRef(false);

	const getApiKey = useCallback(() => apiKeyRef.current, []);
	const getBackendToken = useCallback(() => backendTokenRef.current, []);
	const setApiKey = useCallback((v: string) => {
		apiKeyRef.current = v;
	}, []);
	const setBackendToken = useCallback((v: string) => {
		backendTokenRef.current = v;
	}, []);

	const load = useCallback(async () => {
		if (loadedRef.current) return;
		loadedRef.current = true;

		const [s, key, bToken] = await Promise.all([
			getSettings(),
			storageGetApiKey(),
			storageGetBackendToken(),
		]);

		apiKeyRef.current = key;
		backendTokenRef.current = bToken;

		setFormValues({
			endpoint: s.endpoint,
			model: s.model,
			promptTemplate: s.promptTemplate,
			fewShotPairs: s.fewShotPairs ?? [],
			tagsText: (s.recommendedTags ?? []).join("\n"),
			mappingText: JSON.stringify(s.fieldMapping, null, 2),
			fallbackModel: s.fallbackModel ?? "",
			backendUrl: s.backendUrl ?? "",
			reviewCriteriaPrompt: s.reviewCriteriaPrompt ?? "",
			dailyBatchSize: String(s.dailyBatchSize ?? 5),
		});
	}, []);

	const derivedFewShotExamples = deriveFewShotExamples(formValues.fewShotPairs);

	const save = useCallback(async (): Promise<string | null> => {
		const validationErr = validateSettingsForm({
			endpoint: formValues.endpoint,
			mappingText: formValues.mappingText,
			backendUrl: formValues.backendUrl,
		});
		if (validationErr) return validationErr;

		const existing = await getSettings();
		let fieldMappingParsed: FieldMapping;
		try {
			fieldMappingParsed = JSON.parse(formValues.mappingText) as FieldMapping;
		} catch {
			return "字段映射 JSON 解析失败。";
		}

		await saveSettings({
			...existing,
			endpoint: formValues.endpoint,
			model: formValues.model,
			promptTemplate: formValues.promptTemplate,
			fewShotPairs: formValues.fewShotPairs,
			recommendedTags: parseTagsText(formValues.tagsText),
			fieldMapping: fieldMappingParsed,
			fallbackModel: formValues.fallbackModel || undefined,
			backendUrl: formValues.backendUrl || undefined,
			reviewCriteriaPrompt: formValues.reviewCriteriaPrompt || undefined,
			dailyBatchSize:
				Number.parseInt(formValues.dailyBatchSize, 10) || undefined,
		});
		await saveApiKey(apiKeyRef.current);
		await saveBackendToken(backendTokenRef.current);
		return null;
	}, [formValues]);

	const loadPrompts = useCallback(async () => {
		const result = await fetchPrompts();
		if (result.ok && result.prompts) {
			setPrompts(result.prompts);
			setPromptStatus(`已加載 ${result.prompts.length} 個模板`);
		} else {
			setPromptStatus(`加載失敗：${result.error ?? "未知錯誤"}`);
		}
	}, []);

	const selectPrompt = useCallback(
		(id: string) => {
			const tpl = prompts.find((p) => p.id === id);
			if (!tpl) return;
			setSelectedPromptId(id);
			setFormValues((prev) => ({
				...prev,
				promptTemplate: tpl.template,
				fewShotPairs: tpl.fewShotPairs ?? [],
			}));
		},
		[prompts],
	);

	const savePromptToBackend = useCallback(
		async (name: string) => {
			const result = await createPrompt({
				name,
				template: formValues.promptTemplate,
				fewShotPairs: formValues.fewShotPairs,
				model: formValues.model || undefined,
			});
			if (result.ok) {
				setPromptStatus("已儲存至後端");
			} else {
				setPromptStatus(`儲存失敗：${result.error ?? "未知錯誤"}`);
			}
			await loadPrompts();
		},
		[formValues, loadPrompts],
	);

	const testConnectionFn =
		useCallback(async (): Promise<ConnectionTestResult> => {
			return runTestConnection();
		}, []);

	const setFormValue = useCallback(
		<K extends keyof SettingsFormValues>(
			key: K,
			value: SettingsFormValues[K],
		) => {
			setFormValues((prev) => ({ ...prev, [key]: value }));
		},
		[],
	);

	const setFewShotPairs = useCallback((pairs: FewShotPair[]) => {
		setFormValues((prev) => ({ ...prev, fewShotPairs: pairs }));
	}, []);

	return {
		formValues,
		getApiKey,
		getBackendToken,
		setApiKey,
		setBackendToken,
		derivedFewShotExamples,
		prompts,
		selectedPromptId,
		promptStatus,
		load,
		save,
		loadPrompts,
		selectPrompt,
		savePromptToBackend,
		testConnectionFn,
		setFormValue,
		setFewShotPairs,
	};
}
