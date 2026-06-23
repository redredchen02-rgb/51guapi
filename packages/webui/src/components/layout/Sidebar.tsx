import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, FileText, ListTodo, Rss, Settings, Tv } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
	{ to: "/pending", icon: ListTodo, label: "待審選題" },
	{ to: "/draft", icon: FileText, label: "草稿編輯器" },
	{ to: "/sites", icon: Tv, label: "吃瓜站點" },
	{ to: "/channels", icon: Rss, label: "渠道管理" },
	{ to: "/metrics", icon: BarChart3, label: "運行狀態" },
	{ to: "/settings", icon: Settings, label: "設定" },
] as const;

export function Sidebar() {
	const { location } = useRouterState();

	return (
		<aside className="flex h-full w-56 flex-col border-r border-border bg-surface">
			<div className="flex h-14 items-center gap-2 border-b border-border px-4">
				<span className="text-xl">🍉</span>
				<span className="font-semibold text-foreground">吃瓜小幫手</span>
			</div>
			<nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
				{navItems.map(({ to, icon: Icon, label }) => {
					const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
					return (
						<Link
							key={to}
							to={to}
							className={cn(
								"flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
								isActive
									? "bg-primary/10 text-primary font-medium"
									: "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
						>
							<Icon size={16} />
							{label}
						</Link>
					);
				})}
			</nav>
			<div className="border-t border-border px-4 py-3">
				<p className="text-xs text-muted-foreground">v0.1.0</p>
			</div>
		</aside>
	);
}
