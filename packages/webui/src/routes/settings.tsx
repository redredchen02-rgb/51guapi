import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBaseUrl, setBaseUrl } from "@/lib/api-client";

export const Route = createFileRoute("/settings")({
	component: SettingsPage,
});

function SettingsPage() {
	const [backendUrl, setBackendUrlState] = useState("");

	useEffect(() => {
		setBackendUrlState(getBaseUrl());
	}, []);

	const handleSave = () => {
		try {
			const url = new URL(backendUrl);
			if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
				toast.error("僅允許 localhost 或 127.0.0.1 的後端地址");
				return;
			}
			setBaseUrl(backendUrl);
			toast.success("設定已儲存，請重新整理頁面");
		} catch {
			toast.error("URL 格式無效");
		}
	};

	return (
		<div className="p-6 max-w-lg space-y-6">
			<section className="space-y-3">
				<div>
					<h3 className="text-sm font-semibold text-foreground">後端連線</h3>
					<p className="text-xs text-muted-foreground mt-0.5">
						WebUI 連接的後端地址。只允許 localhost /
						127.0.0.1，保存後重新整理生效。
					</p>
				</div>
				<div className="flex gap-2">
					<Input
						value={backendUrl}
						onChange={(e) => setBackendUrlState(e.target.value)}
						placeholder="http://localhost:3002"
						className="font-mono text-sm"
					/>
					<Button onClick={handleSave}>儲存</Button>
				</div>
			</section>

			<section className="space-y-2">
				<h3 className="text-sm font-semibold text-foreground">說明</h3>
				<ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
					<li>
						LLM 設定（API Key、模型、Prompt）在 Chrome 擴充功能的設定頁管理
					</li>
					<li>WebUI 只作查看、核准、導出用途，不負責 LLM 呼叫的金鑰儲存</li>
					<li>
						CORS 設定需在後端{" "}
						<code className="text-xs bg-muted rounded px-1">CORS_ORIGIN</code>{" "}
						加入{" "}
						<code className="text-xs bg-muted rounded px-1">
							http://localhost:5173
						</code>
					</li>
				</ul>
			</section>
		</div>
	);
}
