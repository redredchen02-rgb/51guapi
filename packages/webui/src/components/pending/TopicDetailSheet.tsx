import type { PendingTopic } from "@51guapi/shared";
import { ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./TopicFilters";

interface TopicDetailSheetProps {
	topic: PendingTopic | null;
	onClose: () => void;
	onApprove: (id: string) => void;
	onReject: (id: string) => void;
	isActing?: boolean;
}

export function TopicDetailSheet({
	topic,
	onClose,
	onApprove,
	onReject,
	isActing,
}: TopicDetailSheetProps) {
	if (!topic) return null;

	const factEntries = Object.entries(topic.facts).filter(([, v]) => v);

	return (
		<div className="fixed inset-y-0 right-0 z-50 flex w-[28rem] flex-col border-l border-border bg-background shadow-xl">
			<div className="flex items-center justify-between border-b border-border px-5 py-4">
				<h3 className="font-semibold text-foreground">選題詳情</h3>
				<button
					type="button"
					onClick={onClose}
					className="rounded-sm text-muted-foreground hover:text-foreground"
				>
					<X size={18} />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
				<div className="space-y-1.5">
					<div className="flex items-center gap-2">
						<StatusBadge status={topic.status} />
						{topic.domain && (
							<Badge variant="outline" className="text-xs">
								{topic.domain}
							</Badge>
						)}
					</div>
					<h4 className="text-lg font-medium leading-snug text-foreground">
						{topic.title}
					</h4>
					<a
						href={topic.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
					>
						<ExternalLink size={11} />
						{topic.siteName}
					</a>
				</div>

				{factEntries.length > 0 && (
					<div className="space-y-2">
						<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							提取事實
						</p>
						<dl className="space-y-1.5">
							{factEntries.map(([k, v]) => (
								<div
									key={k}
									className="grid grid-cols-[7rem_1fr] gap-x-3 text-sm"
								>
									<dt className="font-medium text-muted-foreground truncate">
										{k}
									</dt>
									<dd className="text-foreground break-words">{v}</dd>
								</div>
							))}
						</dl>
					</div>
				)}

				<div className="space-y-1">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						品質分數
					</p>
					<p className="text-2xl font-bold text-foreground">
						{Math.round((topic.score ?? topic.confidence) * 100)}
					</p>
				</div>
			</div>

			{topic.status === "pending" && (
				<div className="flex gap-2 border-t border-border px-5 py-4">
					<Button
						className="flex-1"
						onClick={() => onApprove(topic.id)}
						disabled={isActing}
					>
						核准
					</Button>
					<Button
						variant="destructive"
						className="flex-1"
						onClick={() => onReject(topic.id)}
						disabled={isActing}
					>
						拒絕
					</Button>
				</div>
			)}
		</div>
	);
}
