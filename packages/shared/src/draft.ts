import type { AssembledDraft } from "./post-assembler.js";
import type { ContentDraft } from "./types.js";

export function toDraft(
	assembled: AssembledDraft,
	category: string,
	tags: string[],
	id: string,
	now: string,
): ContentDraft {
	return {
		id,
		title: assembled.title,
		subtitle: assembled.subtitle,
		category,
		coverImageUrl: "",
		body: assembled.body,
		tags,
		description: assembled.description,
		postStatus: "0",
		publishedAt: "",
		mediaId: "",
		status: "draft",
		createdAt: now,
	};
}
