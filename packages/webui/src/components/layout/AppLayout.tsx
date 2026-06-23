import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface AppLayoutProps {
	children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
	return (
		<div className="flex h-screen overflow-hidden bg-background">
			<Sidebar />
			<div className="flex flex-1 flex-col overflow-hidden">
				<Topbar />
				<main className="flex-1 overflow-y-auto">{children}</main>
			</div>
		</div>
	);
}
