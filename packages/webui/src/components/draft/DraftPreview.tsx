import type { ContentDraft } from "@51guapi/shared";
import DOMPurify from "dompurify";

interface DraftPreviewProps {
	draft: ContentDraft;
}

export function DraftPreview({ draft }: DraftPreviewProps) {
	// DOMPurify sanitizes body HTML before render — required by CLAUDE.md security constraints.
	// Only allow safe inline HTML; no scripts, no iframes, no event handlers.
	const safeBody = DOMPurify.sanitize(draft.body, {
		ALLOWED_TAGS: [
			"p",
			"br",
			"strong",
			"em",
			"ul",
			"ol",
			"li",
			"h2",
			"h3",
			"blockquote",
		],
		ALLOWED_ATTR: [],
	});

	return (
		<div className="space-y-4">
			<div className="space-y-1">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					標題
				</p>
				<p className="text-lg font-semibold text-foreground">{draft.title}</p>
			</div>
			{draft.subtitle && (
				<div className="space-y-1">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						副標
					</p>
					<p className="text-sm text-muted-foreground">{draft.subtitle}</p>
				</div>
			)}
			<div className="space-y-1">
				<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					正文
				</p>
				{/* safe: body passes through DOMPurify above */}
				<div
					className="prose prose-sm max-w-none text-foreground dark:prose-invert"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify
					dangerouslySetInnerHTML={{ __html: safeBody }}
				/>
			</div>
		</div>
	);
}
