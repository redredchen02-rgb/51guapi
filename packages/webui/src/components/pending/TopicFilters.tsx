import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TopicFiltersProps {
	currentStatus: "pending" | "approved" | "rejected" | undefined;
	onStatusChange: (
		status: "pending" | "approved" | "rejected" | undefined,
	) => void;
}

const STATUS_OPTIONS = [
	{ value: undefined, label: "全部" },
	{ value: "pending" as const, label: "待審" },
	{ value: "approved" as const, label: "已核准" },
	{ value: "rejected" as const, label: "已拒絕" },
];

export function TopicFilters({
	currentStatus,
	onStatusChange,
}: TopicFiltersProps) {
	return (
		<div className="flex items-center gap-2">
			{STATUS_OPTIONS.map((opt) => (
				<button
					key={String(opt.value)}
					type="button"
					onClick={() => onStatusChange(opt.value)}
					className={cn(
						"rounded-full px-3 py-1 text-xs font-medium transition-colors",
						currentStatus === opt.value
							? "bg-primary text-primary-foreground"
							: "bg-muted text-muted-foreground hover:bg-muted/70",
					)}
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}

export function StatusBadge({
	status,
}: {
	status: "pending" | "approved" | "rejected";
}) {
	const variants = {
		pending: "secondary",
		approved: "default",
		rejected: "destructive",
	} as const;
	const labels = { pending: "待審", approved: "核准", rejected: "拒絕" };
	return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}
