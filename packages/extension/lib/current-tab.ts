// 读取当前浏览器标签页 URL。
// tabs 权限在 wxt.config.ts 中声明,side panel 不触发 activeTab 临时授权,
// 必须显式声明 tabs 才能访问 tab.url。

type TabsQueryFn = (info: {
	active: boolean;
	currentWindow: boolean;
}) => Promise<Array<{ url?: string }>>;

/**
 * 返回当前活动标签页的 URL(仅 http/https)。
 * 非 http/https URL(chrome://、about: 等)或无法获取时返回 null。
 * @param queryFn 可注入的 browser.tabs.query 替代,用于测试。
 */
export async function getCurrentTabUrl(
	queryFn?: TabsQueryFn,
): Promise<string | null> {
	try {
		const query = queryFn ?? ((info) => browser.tabs.query(info));
		const tabs = await query({ active: true, currentWindow: true });
		const url = tabs[0]?.url;
		if (!url || !/^https?:\/\//i.test(url)) return null;
		return url;
	} catch {
		return null;
	}
}
