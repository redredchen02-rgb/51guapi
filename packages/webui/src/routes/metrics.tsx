import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle, RefreshCw, XCircle } from "lucide-react";
import { getHealthz, getPreflight } from "@/api/metrics";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/metrics")({
	component: MetricsPage,
});

function MetricsPage() {
	const healthz = useQuery({
		queryKey: ["healthz"],
		queryFn: getHealthz,
		refetchInterval: 30_000,
	});

	const preflight = useQuery({
		queryKey: ["preflight"],
		queryFn: getPreflight,
		refetchInterval: 60_000,
	});

	const refresh = () => {
		healthz.refetch();
		preflight.refetch();
	};

	return (
		<div className="p-6 space-y-6">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">每 30s 自動刷新</p>
				<Button variant="outline" size="sm" onClick={refresh}>
					<RefreshCw size={13} className="mr-1.5" />
					手動刷新
				</Button>
			</div>

			{/* Health tiles */}
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
				<HealthTile
					label="服務狀態"
					value={healthz.data ? "運行中" : healthz.isError ? "錯誤" : null}
					isLoading={healthz.isLoading}
					ok={!healthz.isError}
				/>
				<HealthTile
					label="啟動時間"
					value={
						healthz.data
							? `${Math.floor((healthz.data.uptime ?? 0) / 60)} 分`
							: null
					}
					isLoading={healthz.isLoading}
				/>
				<HealthTile
					label="版本"
					value={healthz.data?.version ?? null}
					isLoading={healthz.isLoading}
				/>
				<HealthTile
					label="資料庫"
					value={
						healthz.data?.database?.ok
							? "正常"
							: healthz.data?.database
								? "異常"
								: null
					}
					isLoading={healthz.isLoading}
					ok={healthz.data?.database?.ok}
				/>
			</div>

			{/* Preflight checks */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-sm font-semibold">
						Preflight 檢查
					</CardTitle>
				</CardHeader>
				<CardContent>
					{preflight.isLoading ? (
						<div className="space-y-2">
							{Array.from({ length: 4 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: skeleton
								<Skeleton key={i} className="h-8 w-full" />
							))}
						</div>
					) : preflight.isError ? (
						<p className="text-sm text-destructive">無法取得 Preflight 結果</p>
					) : preflight.data?.checks.length === 0 ? (
						<p className="text-sm text-muted-foreground">無檢查項目</p>
					) : (
						<ul className="space-y-1.5">
							{preflight.data?.checks.map((check) => (
								<li
									key={check.id}
									className="flex items-start gap-2.5 rounded-md border border-border p-2.5 text-sm"
								>
									{check.pass ? (
										<CheckCircle
											size={14}
											className="mt-0.5 shrink-0 text-green-500"
										/>
									) : (
										<XCircle
											size={14}
											className="mt-0.5 shrink-0 text-destructive"
										/>
									)}
									<div className="min-w-0">
										<span
											className={cn(
												"font-medium",
												check.pass ? "text-foreground" : "text-destructive",
											)}
										>
											{check.label}
										</span>
										{check.detail && (
											<p className="mt-0.5 text-xs text-muted-foreground">
												{check.detail}
											</p>
										)}
									</div>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function HealthTile({
	label,
	value,
	isLoading,
	ok,
}: {
	label: string;
	value: string | null;
	isLoading: boolean;
	ok?: boolean;
}) {
	return (
		<Card>
			<CardContent className="pt-4">
				<p className="text-xs text-muted-foreground">{label}</p>
				{isLoading ? (
					<Skeleton className="mt-1 h-6 w-20" />
				) : (
					<p
						className={cn(
							"mt-1 text-xl font-bold",
							ok === false && "text-destructive",
						)}
					>
						{value ?? "—"}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
