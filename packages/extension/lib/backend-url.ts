// 后端 URL 配置：从 settings.backendUrl 读取，未配置时回退到默认值。
import { storage } from "#imports";

const SETTINGS_KEY = "local:settings";
const DEFAULT_BACKEND = "http://127.0.0.1:3001";

let cachedUrl: string | undefined;

/** 获取后端 URL（优先从 settings 读取）。 */
export async function getBackendUrl(): Promise<string> {
	if (cachedUrl !== undefined) return cachedUrl;

	try {
		const settings = await storage.getItem<{ backendUrl?: string }>(
			SETTINGS_KEY,
		);
		cachedUrl = settings?.backendUrl || DEFAULT_BACKEND;
	} catch {
		cachedUrl = DEFAULT_BACKEND;
	}

	return cachedUrl;
}

/** 清除缓存（settings 变更后调用）。 */
export function clearBackendUrlCache(): void {
	cachedUrl = undefined;
}
