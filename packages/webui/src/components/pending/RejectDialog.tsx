import type { RejectionReason } from "@51guapi/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

const REJECTION_REASONS: { value: RejectionReason; label: string }[] = [
	{ value: "duplicate", label: "重複選題" },
	{ value: "quality", label: "品質不足" },
	{ value: "topic_mismatch", label: "類型不符" },
	{ value: "missing_facts", label: "資訊缺失" },
	{ value: "other", label: "其他" },
];

interface RejectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (reason: RejectionReason) => void;
	isPending?: boolean;
}

export function RejectDialog({
	open,
	onOpenChange,
	onConfirm,
	isPending,
}: RejectDialogProps) {
	const [reason, setReason] = useState<RejectionReason>("quality");

	const handleConfirm = () => {
		onConfirm(reason);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>拒絕原因</DialogTitle>
				</DialogHeader>
				<Select
					value={reason}
					onValueChange={(v) => setReason(v as RejectionReason)}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{REJECTION_REASONS.map((r) => (
							<SelectItem key={r.value} value={r.value}>
								{r.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isPending}
					>
						取消
					</Button>
					<Button
						variant="destructive"
						onClick={handleConfirm}
						disabled={isPending}
					>
						{isPending ? "處理中…" : "確認拒絕"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
