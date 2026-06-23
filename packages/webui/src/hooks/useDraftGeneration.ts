import { useMutation } from "@tanstack/react-query";
import { type ContentDraft, type GossipFactsBlock, type Settings } from "@51guapi/shared";
import { generateDraft, reviewDraft } from "@/api/draft";

export function useGenerateDraft() {
	return useMutation({
		mutationFn: (params: {
			prompt: string;
			settings?: Partial<Settings>;
			facts?: GossipFactsBlock;
		}) => generateDraft(params),
	});
}

export function useReviewDraft() {
	return useMutation({
		mutationFn: (params: {
			draft: ContentDraft;
			settings?: Partial<Settings>;
		}) => reviewDraft(params),
	});
}
