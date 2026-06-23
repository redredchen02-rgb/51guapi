import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RejectionReason } from "@51guapi/shared";
import { type ListPendingTopicsParams, deletePendingTopic, listPendingTopics, patchPendingTopic } from "@/api/pending";

export function usePendingTopics(params: ListPendingTopicsParams = {}) {
	return useQuery({
		queryKey: ["pending-topics", params],
		queryFn: () => listPendingTopics(params),
		select: (data) => data.topics,
	});
}

export function useApproveTopic() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => patchPendingTopic(id, { status: "approved" }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-topics"] }),
	});
}

export function useRejectTopic() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, reason }: { id: string; reason: RejectionReason }) =>
			patchPendingTopic(id, { status: "rejected", rejectedReason: reason }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-topics"] }),
	});
}

export function useDeleteTopic() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deletePendingTopic(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-topics"] }),
	});
}
