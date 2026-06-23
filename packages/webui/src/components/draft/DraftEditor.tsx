import type { ContentDraft } from "@51guapi/shared";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGenerateDraft } from "@/hooks/useDraftGeneration";
import { DraftPreview } from "./DraftPreview";
import { ExportPanel } from "./ExportPanel";
import { QualityReviewPanel } from "./QualityReviewPanel";

const DEFAULT_PROMPT =
	"請根據以上事實，以輕鬆幽默的口吻撰寫一篇吃瓜文章，字數約 600-800 字。";

export function DraftEditor() {
	const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
	const [draft, setDraft] = useState<ContentDraft | null>(null);
	const [bodyEdit, setBodyEdit] = useState("");

	const generate = useGenerateDraft();

	const handleGenerate = async () => {
		try {
			const res = await generate.mutateAsync({ prompt });
			if (res.ok) {
				setDraft(res.draft);
				setBodyEdit(res.draft.body);
			} else {
				toast.error(`生成失敗：${res.error}`);
			}
		} catch {
			toast.error("生成請求失敗");
		}
	};

	const draftWithEdits: ContentDraft | null = draft
		? { ...draft, body: bodyEdit }
		: null;

	return (
		<div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
			{/* Left panel: prompt + generate */}
			<div className="space-y-4">
				<div className="rounded-lg border border-border bg-background p-4 space-y-3">
					<p className="text-sm font-medium text-foreground">生成提示詞</p>
					<Textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						rows={6}
						className="resize-none text-sm"
						placeholder="輸入生成指令…"
					/>
					<Button
						className="w-full"
						onClick={handleGenerate}
						disabled={generate.isPending || !prompt.trim()}
					>
						{generate.isPending ? "生成中…" : "生成草稿"}
					</Button>
				</div>

				{draftWithEdits && (
					<div className="rounded-lg border border-border bg-background p-4">
						<QualityReviewPanel draft={draftWithEdits} />
					</div>
				)}

				{draftWithEdits && (
					<div className="rounded-lg border border-border bg-background p-4 space-y-2">
						<p className="text-sm font-medium text-foreground">導出</p>
						<ExportPanel draft={draftWithEdits} />
					</div>
				)}
			</div>

			{/* Right panel: edit / preview tabs */}
			{draftWithEdits ? (
				<div className="rounded-lg border border-border bg-background">
					<Tabs defaultValue="edit">
						<div className="flex items-center justify-between border-b border-border px-4">
							<TabsList className="my-2">
								<TabsTrigger value="edit">編輯</TabsTrigger>
								<TabsTrigger value="preview">預覽</TabsTrigger>
							</TabsList>
						</div>
						<TabsContent value="edit" className="p-4">
							<Textarea
								value={bodyEdit}
								onChange={(e) => setBodyEdit(e.target.value)}
								className="min-h-[500px] resize-y font-mono text-sm"
							/>
						</TabsContent>
						<TabsContent value="preview" className="p-4">
							<DraftPreview draft={draftWithEdits} />
						</TabsContent>
					</Tabs>
				</div>
			) : (
				<div className="flex items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
					{generate.isPending ? "生成中，請稍候…" : "生成草稿後顯示於此"}
				</div>
			)}
		</div>
	);
}
