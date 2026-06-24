import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertCircle,
	ChevronDown,
	ChevronUp,
	EyeOff,
	Globe,
	RefreshCw,
	Sparkles,
	TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	generateDraftFromRanking,
	getRanking,
	hideKeyword,
	type RankedKeyword,
	type RankedTopic,
	triggerScrape,
} from "@/api/ranking";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/gossip-rank")({
	component: GossipRankPage,
});

function GossipRankPage() {
	const qc = useQueryClient();

	const { data, isLoading, error, dataUpdatedAt } = useQuery({
		queryKey: ["gossip-ranking"],
		queryFn: getRanking,
		staleTime: 60_000,
	});

	const scrape = useMutation({
		mutationFn: triggerScrape,
		onSuccess: (res) => {
			qc.invalidateQueries({ queryKey: ["gossip-ranking"] });
			qc.invalidateQueries({ queryKey: ["pending-topics"] });
			const msg = `熱搜 ${res.hotKeywordsCount} 個，新話題 ${res.topicsDiscovered} 條`;
			if (res.errors.length > 0) {
				toast.warning(`抓取完成（${res.errors.length} 個錯誤）：${msg}`);
			} else {
				toast.success(`抓取完成：${msg}`);
			}
		},
		onError: () => toast.error("抓取失敗"),
	});

	const freshAt = data?.freshAt ? new Date(data.freshAt) : null;
	const lastUpdate = dataUpdatedAt
		? new Date(dataUpdatedAt).toLocaleString("zh-TW", {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			})
		: null;

	return (
		<div className="p-6 space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold">
						<TrendingUp size={18} className="text-primary" />
						吃瓜排行
					</h1>
					{freshAt && (
						<p className="text-xs text-muted-foreground mt-0.5">
							資料時間：{freshAt.toLocaleString("zh-TW")}
							{lastUpdate && (
								<span className="ml-2 opacity-60">
									（本地刷新 {lastUpdate}）
								</span>
							)}
						</p>
					)}
				</div>
				<Button
					size="sm"
					onClick={() => scrape.mutate()}
					disabled={scrape.isPending}
				>
					<RefreshCw
						size={14}
						className={`mr-1.5 ${scrape.isPending ? "animate-spin" : ""}`}
					/>
					{scrape.isPending ? "抓取中…" : "立即抓取"}
				</Button>
			</div>

			{isLoading ? (
				<RankingSkeleton />
			) : error ? (
				<div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
					<AlertCircle size={16} />
					載入失敗，請稍後重試
				</div>
			) : (
				<>
					<SectionA topics={data?.sectionA ?? []} />
					<SectionB keywords={data?.sectionB ?? []} />
				</>
			)}
		</div>
	);
}

function SectionA({ topics }: { topics: RankedTopic[] }) {
	const qc = useQueryClient();
	const [collapsed, setCollapsed] = useState(false);

	const hide = useMutation({
		mutationFn: (keyword: string) => hideKeyword(keyword),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["gossip-ranking"] });
			toast.success("已隱藏");
		},
	});

	const gen = useMutation({
		mutationFn: generateDraftFromRanking,
		onSuccess: (res) => {
			if (res.ok) {
				qc.invalidateQueries({ queryKey: ["pending-topics"] });
				toast.success("草稿已生成，請至待審選題查看");
			} else {
				toast.error(res.error ?? "生成失敗");
			}
		},
		onError: () => toast.error("生成失敗"),
	});

	return (
		<section className="rounded-lg border border-border bg-background">
			<button
				type="button"
				className="flex w-full items-center gap-2 p-4 text-left"
				onClick={() => setCollapsed((v) => !v)}
			>
				<span className="font-medium text-sm">A 區 — 精選交集</span>
				<Badge variant="secondary">{topics.length}</Badge>
				<span className="ml-auto text-muted-foreground">
					{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
				</span>
			</button>

			{!collapsed && (
				<div className="border-t border-border">
					{topics.length === 0 ? (
						<div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
							無交集話題 — 請先用站點 Zap 鍵探索，再按「立即抓取」更新熱搜
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-8">#</TableHead>
									<TableHead>標題</TableHead>
									<TableHead className="w-24 text-center">分數</TableHead>
									<TableHead className="w-24 text-center">站點</TableHead>
									<TableHead className="w-36">匹配關鍵詞</TableHead>
									<TableHead className="w-28 text-center">操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{topics.map((t, i) => (
									<TableRow key={t.topicId}>
										<TableCell className="text-muted-foreground text-xs">
											{i + 1}
										</TableCell>
										<TableCell>
											<a
												href={t.sourceUrl}
												target="_blank"
												rel="noreferrer"
												className="hover:text-primary hover:underline font-medium text-sm line-clamp-2"
											>
												{t.title}
											</a>
											<div className="flex items-center gap-1 mt-1">
												<Globe size={11} className="text-muted-foreground" />
												<span className="text-xs text-muted-foreground">
													{t.siteName}
												</span>
												{t.sourcePlatforms.map((p) => (
													<PlatformBadge
														key={p.platform}
														platform={p.platform}
													/>
												))}
											</div>
										</TableCell>
										<TableCell className="text-center">
											<span className="text-sm font-medium tabular-nums">
												{t.score.toFixed(2)}
											</span>
										</TableCell>
										<TableCell className="text-center text-xs text-muted-foreground">
											{t.siteCount} / {t.platformCount} 平台
										</TableCell>
										<TableCell>
											<div className="flex flex-wrap gap-1">
												{t.matchedKeywords.slice(0, 3).map((kw) => (
													<Badge
														key={kw}
														variant="outline"
														className="text-xs px-1 py-0 cursor-pointer hover:bg-destructive/10"
														onClick={() => hide.mutate(kw)}
														title="隱藏此關鍵詞"
													>
														{kw}
													</Badge>
												))}
												{t.matchedKeywords.length > 3 && (
													<Badge
														variant="outline"
														className="text-xs px-1 py-0 text-muted-foreground"
													>
														+{t.matchedKeywords.length - 3}
													</Badge>
												)}
											</div>
										</TableCell>
										<TableCell>
											<div className="flex items-center justify-center gap-1">
												<Button
													size="icon"
													variant="ghost"
													className="h-7 w-7 text-primary"
													title="一鍵生成草稿"
													onClick={() => gen.mutate(t.topicId)}
													disabled={
														gen.isPending && gen.variables === t.topicId
													}
												>
													<Sparkles size={13} />
												</Button>
												<Button
													size="icon"
													variant="ghost"
													className="h-7 w-7 text-muted-foreground"
													title="隱藏此話題"
													onClick={() => hide.mutate(t.title)}
												>
													<EyeOff size={13} />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</div>
			)}
		</section>
	);
}

function SectionB({ keywords }: { keywords: RankedKeyword[] }) {
	const qc = useQueryClient();
	const [collapsed, setCollapsed] = useState(false);

	const hide = useMutation({
		mutationFn: hideKeyword,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["gossip-ranking"] });
			toast.success("已隱藏");
		},
	});

	return (
		<section className="rounded-lg border border-border bg-background">
			<button
				type="button"
				className="flex w-full items-center gap-2 p-4 text-left"
				onClick={() => setCollapsed((v) => !v)}
			>
				<span className="font-medium text-sm">B 區 — 熱搜未覆蓋</span>
				<Badge variant="outline">{keywords.length}</Badge>
				<span className="ml-auto text-muted-foreground">
					{collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
				</span>
			</button>

			{!collapsed && (
				<div className="border-t border-border">
					{keywords.length === 0 ? (
						<div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
							所有熱搜詞均已被站點覆蓋
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-8">#</TableHead>
									<TableHead>關鍵詞</TableHead>
									<TableHead className="w-28 text-center">平台覆蓋</TableHead>
									<TableHead className="w-28 text-center">平均熱度</TableHead>
									<TableHead className="w-20 text-center">操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{keywords.map((kw, i) => (
									<TableRow key={kw.keyword}>
										<TableCell className="text-muted-foreground text-xs">
											{i + 1}
										</TableCell>
										<TableCell className="font-medium text-sm">
											{kw.keyword}
										</TableCell>
										<TableCell className="text-center">
											<div className="flex items-center justify-center gap-1 flex-wrap">
												{kw.platforms.map((p) => (
													<PlatformBadge
														key={p.platform}
														platform={p.platform}
													/>
												))}
											</div>
										</TableCell>
										<TableCell className="text-center text-xs tabular-nums">
											{kw.avgHeatScore.toFixed(1)}
										</TableCell>
										<TableCell className="text-center">
											<Button
												size="icon"
												variant="ghost"
												className="h-7 w-7 text-muted-foreground"
												title="隱藏此關鍵詞"
												onClick={() => hide.mutate(kw.keyword)}
												disabled={
													hide.isPending && hide.variables === kw.keyword
												}
											>
												<EyeOff size={13} />
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</div>
			)}
		</section>
	);
}

function PlatformBadge({ platform }: { platform: string }) {
	const labels: Record<string, string> = {
		baidu: "百度",
		weibo: "微博",
		douyin: "抖音",
		xiaohongshu: "小紅書",
	};
	return (
		<Badge variant="secondary" className="text-[10px] px-1 py-0">
			{labels[platform] ?? platform}
		</Badge>
	);
}

function RankingSkeleton() {
	return (
		<div className="space-y-4">
			{[0, 1].map((i) => (
				<div key={i} className="rounded-lg border border-border p-4 space-y-2">
					<Skeleton className="h-5 w-32" />
					<Skeleton className="h-40 w-full" />
				</div>
			))}
		</div>
	);
}
