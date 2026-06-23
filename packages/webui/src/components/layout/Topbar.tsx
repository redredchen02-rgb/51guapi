import { useRouterState } from "@tanstack/react-router";

const ROUTE_TITLES: Record<string, string> = {
	"/pending": "待審選題",
	"/draft": "草稿編輯器",
	"/sites": "吃瓜站點",
	"/channels": "渠道管理",
	"/metrics": "運行狀態",
	"/settings": "設定",
};

export function Topbar() {
	const { location } = useRouterState();
	const title = ROUTE_TITLES[location.pathname] ?? "吃瓜小幫手";

	return (
		<header className="flex h-14 items-center border-b border-border bg-background px-6">
			<h2 className="text-base font-semibold text-foreground">{title}</h2>
		</header>
	);
}
