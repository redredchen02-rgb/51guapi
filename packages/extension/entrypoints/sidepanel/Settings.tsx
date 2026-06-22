import { useEffect, useState } from "react";
import { logger } from "../../lib/logger";
import { BackendSection } from "./components/BackendSection";
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

export interface SettingsValidationValues {
	endpoint: string;
	backendUrl: string;
}

export function validateSettingsForm(
	values: SettingsValidationValues,
): string | null {
	const { endpoint, backendUrl } = values;
	if (endpoint && !/^https:\/\//i.test(endpoint)) {
		return "endpoint 必须是 https:// 地址(API key 会发往此处)。";
	}
	if (
		backendUrl &&
		!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(backendUrl)
	) {
		return "后端 URL 必须是 localhost 或 127.0.0.1 地址（例：http://localhost:3002）。";
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
				getBackendToken={getBackendToken}
				setBackendUrl={(v) => setFormValue("backendUrl", v)}
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
