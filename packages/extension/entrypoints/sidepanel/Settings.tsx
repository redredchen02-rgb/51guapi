import { isValidFieldMapping, VALID_FIELD_TYPES } from "@51guapi/shared";
import { useEffect, useState } from "react";
import { logger } from "../../lib/logger";
import { DEFAULT_SETTINGS } from "../../lib/storage";
import { BackendSection } from "./components/BackendSection";
import { FieldMappingSection } from "./components/FieldMappingSection";
import { LLMSection } from "./components/LLMSection";
import { PromptSection } from "./components/PromptSection";
import { TagsSection } from "./components/TagsSection";
import { useSettingsForm } from "./hooks/useSettingsForm";
import styles from "./Settings.module.css";

export function parseTagsText(text: string): string[] {
	return text
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export function validateMapping(text: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		return `JSON 格式错误:${(e as Error).message}`;
	}
	if (!isValidFieldMapping(parsed)) {
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return "字段映射必须是一个对象。";
		for (const [key, def] of Object.entries(
			parsed as Record<string, unknown>,
		)) {
			if (!def || typeof def !== "object") return `字段 ${key} 必须是对象。`;
			const d = def as Record<string, unknown>;
			if (typeof d.selector !== "string" || !d.selector)
				return `字段 ${key} 缺少有效的 selector。`;
			if (
				typeof d.fieldType !== "string" ||
				!(VALID_FIELD_TYPES as readonly string[]).includes(d.fieldType)
			) {
				return `字段 ${key} 的 fieldType 非法(应为:${VALID_FIELD_TYPES.join(" / ")})。`;
			}
		}
		return "字段映射校验失败。";
	}
	return null;
}

export interface SettingsValidationValues {
	endpoint: string;
	mappingText: string;
	backendUrl: string;
}

export function validateSettingsForm(
	values: SettingsValidationValues,
): string | null {
	const { endpoint, mappingText, backendUrl } = values;
	if (endpoint && !/^https:\/\//i.test(endpoint)) {
		return "endpoint 必须是 https:// 地址(API key 会发往此处)。";
	}
	if (mappingText) {
		const mapErr = validateMapping(mappingText);
		if (mapErr) return mapErr;
	}
	if (
		backendUrl &&
		!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(backendUrl)
	) {
		return "后端 URL 必须是 localhost 或 127.0.0.1 地址（例：http://localhost:3001）。";
	}
	return null;
}

export function Settings({ onClose }: { onClose: () => void }) {
	const hook = useSettingsForm();
	const {
		formValues,
		setFormValue,
		getApiKey,
		getBackendToken,
		setApiKey,
		setBackendToken,
	} = hook;
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: hook.load is stable across renders
	useEffect(() => {
		void hook.load();
	}, []);

	async function handleSave() {
		setSaved(false);
		const err = await hook.save();
		if (err) {
			setError(err);
		} else {
			setError("");
			if (formValues.backendUrl?.startsWith("http://")) {
				logger.warn(
					"Settings",
					"后端 URL 使用 HTTP，JWT 以明文传输。建议仅在本地开发时使用。",
				);
			}
			setSaved(true);
		}
	}

	return (
		<div className="fade-in">
			<button
				type="button"
				onClick={onClose}
				className={`btn btn-plain ${styles.backBtn}`}
			>
				← 返回
			</button>
			<h2 className={styles.heading}>设置</h2>

			<p className={`field-hint ${styles.intro}`}>
				⚙️ 大模型 endpoint 与 API Key 已在后端服务 .env 中配置，扩展不直接管理。
			</p>

			<LLMSection
				endpoint={formValues.endpoint}
				model={formValues.model}
				fallbackModel={formValues.fallbackModel}
				getApiKey={getApiKey}
				setEndpoint={(v) => setFormValue("endpoint", v)}
				setModel={(v) => setFormValue("model", v)}
				setFallbackModel={(v) => setFormValue("fallbackModel", v)}
				setApiKey={setApiKey}
			/>

			<BackendSection
				backendUrl={formValues.backendUrl}
				dailyBatchSize={formValues.dailyBatchSize}
				getBackendToken={getBackendToken}
				setBackendUrl={(v) => setFormValue("backendUrl", v)}
				setDailyBatchSize={(v) => setFormValue("dailyBatchSize", v)}
				setBackendToken={setBackendToken}
				onTestConnection={hook.testConnectionFn}
			/>

			<PromptSection
				promptTemplate={formValues.promptTemplate}
				fewShotPairs={formValues.fewShotPairs}
				prompts={hook.prompts}
				selectedPromptId={hook.selectedPromptId}
				promptStatus={hook.promptStatus}
				setPromptTemplate={(v) => setFormValue("promptTemplate", v)}
				setFewShotPairs={hook.setFewShotPairs}
				onLoadPrompts={() => void hook.loadPrompts()}
				onSelectPrompt={hook.selectPrompt}
				onSavePromptToBackend={hook.savePromptToBackend}
			/>

			<TagsSection
				tagsText={formValues.tagsText}
				reviewCriteriaPrompt={formValues.reviewCriteriaPrompt}
				setTagsText={(v) => setFormValue("tagsText", v)}
				setReviewCriteriaPrompt={(v) => setFormValue("reviewCriteriaPrompt", v)}
			/>

			<FieldMappingSection
				mappingText={formValues.mappingText}
				setMappingText={(v) => setFormValue("mappingText", v)}
				onResetMapping={() =>
					setFormValue(
						"mappingText",
						JSON.stringify(DEFAULT_SETTINGS.fieldMapping, null, 2),
					)
				}
			/>

			{error && (
				<p role="alert" className="text-error text-sm">
					{error}
				</p>
			)}
			{saved && <p className="text-success text-sm">已保存。</p>}

			<button
				type="button"
				onClick={() => void handleSave()}
				className={`btn btn-primary ${styles.saveBtn}`}
			>
				保存
			</button>
		</div>
	);
}
