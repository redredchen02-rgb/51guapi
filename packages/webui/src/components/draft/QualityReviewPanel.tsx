import type { ContentDraft } from "@51guapi/shared";
import { CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useReviewDraft } from "@/hooks/useDraftGeneration";
import { cn } from "@/lib/utils";

interface QualityReviewPanelProps {
	draft: ContentDraft;
}

export function QualityReviewPanel({ draft }: QualityReviewPanelProps) {
	const review = useReviewDraft();

	const handleReview = async () => {
		try {
			await review.mutateAsync({ draft });
		} catch {
			toast.error("品質審核失敗");
		}
	};

	const result = review.data?.result;

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<p className="text-sm font-medium text-foreground">品質審核</p>
				<Button
					variant="outline"
					size="sm"
					onClick={handleReview}
					disabled={review.isPending}
				>
					{review.isPending ? "審核中…" : "執行審核"}
				</Button>
			</div>

			{review.isPending && (
				<div className="space-y-2">
					{Array.from({ length: 3 }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: skeleton uses index
						<Skeleton key={i} className="h-8 w-full rounded-md" />
					))}
				</div>
			)}

			{result?.dimensions && (
				<ul className="space-y-1.5">
					{result.dimensions.map((dim) => (
						<li
							key={dim.name}
							className="flex items-start gap-2 rounded-md border border-border p-2.5 text-sm"
						>
							{dim.pass ? (
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
										dim.pass ? "text-foreground" : "text-destructive",
									)}
								>
									{dim.name}
								</span>
								{dim.reason && (
									<p className="mt-0.5 text-xs text-muted-foreground">
										{dim.reason}
									</p>
								)}
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
