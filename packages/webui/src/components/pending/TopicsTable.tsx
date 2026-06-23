import type { PendingTopic, RejectionReason } from "@51guapi/shared";
import { CheckCircle, ChevronRight, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import {
	useApproveTopic,
	useDeleteTopic,
	useRejectTopic,
} from "@/hooks/usePendingTopics";
import { cn } from "@/lib/utils";
import { RejectDialog } from "./RejectDialog";
import { TopicDetailSheet } from "./TopicDetailSheet";

interface TopicsTableProps {
	topics: PendingTopic[] | undefined;
	isLoading: boolean;
}

export function TopicsTable({ topics, isLoading }: TopicsTableProps) {
	const [selected, setSelected] = useState<PendingTopic | null>(null);
	const [rejectTarget, setRejectTarget] = useState<string | null>(null);

	const approve = useApproveTopic();
	const reject = useRejectTopic();
	const del = useDeleteTopic();

	const handleApprove = async (id: string) => {
		try {
			await approve.mutateAsync(id);
			toast.success("已核准");
			if (selected?.id === id) setSelected(null);
		} catch {
			toast.error("核准失敗");
		}
	};

	const handleRejectConfirm = async (reason: RejectionReason) => {
		if (!rejectTarget) return;
		try {
			await reject.mutateAsync({ id: rejectTarget, reason });
			toast.success("已拒絕");
			if (selected?.id === rejectTarget) setSelected(null);
		} catch {
			toast.error("拒絕失敗");
		} finally {
			setRejectTarget(null);
		}
	};

	const handleDelete = async (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		if (!confirm("確定刪除？")) return;
		try {
			await del.mutateAsync(id);
			toast.success("已刪除");
			if (selected?.id === id) setSelected(null);
		} catch {
			toast.error("刪除失敗");
		}
	};

	if (isLoading) {
		return (
			<div className="space-y-2 p-4">
				{Array.from({ length: 5 }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows use index by design
					<Skeleton key={i} className="h-12 w-full rounded-md" />
				))}
			</div>
		);
	}

	if (!topics?.length) {
		return (
			<div className="flex h-48 items-center justify-center text-muted-foreground">
				目前沒有符合條件的選題
			</div>
		);
	}

	const isActing = approve.isPending || reject.isPending;

	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-full">標題</TableHead>
						<TableHead className="w-24 text-center">分數</TableHead>
						<TableHead className="w-20">狀態</TableHead>
						<TableHead className="w-28 text-center">操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{topics.map((topic) => (
						<TableRow
							key={topic.id}
							className={cn(
								"cursor-pointer",
								topic.folded && "opacity-60",
								selected?.id === topic.id && "bg-muted/50",
							)}
							onClick={() => setSelected(topic)}
						>
							<TableCell className="max-w-0">
								<div className="truncate font-medium text-foreground">
									{topic.title}
								</div>
								<div className="truncate text-xs text-muted-foreground">
									{topic.siteName}
								</div>
							</TableCell>
							<TableCell className="text-center text-sm tabular-nums">
								{Math.round((topic.score ?? topic.confidence) * 100)}
							</TableCell>
							<TableCell>
								<StatusChip status={topic.status} />
							</TableCell>
							<TableCell onClick={(e) => e.stopPropagation()}>
								<div className="flex items-center justify-center gap-1">
									{topic.status === "pending" && (
										<>
											<Button
												size="icon"
												variant="ghost"
												className="h-7 w-7 text-green-600 hover:text-green-700"
												title="核准"
												onClick={(e) => {
													e.stopPropagation();
													handleApprove(topic.id);
												}}
												disabled={isActing}
											>
												<CheckCircle size={15} />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												className="h-7 w-7 text-destructive hover:text-destructive/80"
												title="拒絕"
												onClick={(e) => {
													e.stopPropagation();
													setRejectTarget(topic.id);
												}}
												disabled={isActing}
											>
												<XCircle size={15} />
											</Button>
										</>
									)}
									<Button
										size="icon"
										variant="ghost"
										className="h-7 w-7 text-muted-foreground hover:text-destructive"
										title="刪除"
										onClick={(e) => handleDelete(topic.id, e)}
										disabled={del.isPending}
									>
										<Trash2 size={14} />
									</Button>
									<ChevronRight size={14} className="text-muted-foreground" />
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>

			{selected && (
				<>
					{/* backdrop */}
					<div
						className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
						onClick={() => setSelected(null)}
					/>
					<TopicDetailSheet
						topic={selected}
						onClose={() => setSelected(null)}
						onApprove={handleApprove}
						onReject={(id) => setRejectTarget(id)}
						isActing={isActing}
					/>
				</>
			)}

			<RejectDialog
				open={!!rejectTarget}
				onOpenChange={(open) => {
					if (!open) setRejectTarget(null);
				}}
				onConfirm={handleRejectConfirm}
				isPending={reject.isPending}
			/>
		</>
	);
}

function StatusChip({ status }: { status: PendingTopic["status"] }) {
	const cls = {
		pending:
			"bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
		approved:
			"bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
		rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
	}[status];
	const label = { pending: "待審", approved: "核准", rejected: "拒絕" }[status];
	return (
		<span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", cls)}>
			{label}
		</span>
	);
}
