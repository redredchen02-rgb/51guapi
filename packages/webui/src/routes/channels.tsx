import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Rss, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type Channel, addChannel, deleteChannel, listChannels } from "@/api/channels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/channels")({
	component: ChannelsPage,
});

function ChannelsPage() {
	const qc = useQueryClient();
	const [addOpen, setAddOpen] = useState(false);

	const { data, isLoading } = useQuery({
		queryKey: ["channels"],
		queryFn: listChannels,
		select: (d) => d.channels,
	});

	const del = useMutation({
		mutationFn: (id: string) => deleteChannel(id),
		onSuccess: () => { qc.invalidateQueries({ queryKey: ["channels"] }); toast.success("已移除"); },
		onError: () => toast.error("移除失敗"),
	});

	return (
		<div className="p-6 space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">SSRF 允許清單：僅列表內的渠道可爬取</p>
				<Button size="sm" onClick={() => setAddOpen(true)}>
					<Plus size={14} className="mr-1.5" />
					新增渠道
				</Button>
			</div>

			<div className="rounded-lg border border-border bg-background">
				{isLoading ? (
					<div className="space-y-2 p-4">
						{Array.from({ length: 3 }).map((_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: skeleton
							<Skeleton key={i} className="h-10 w-full" />
						))}
					</div>
				) : !data?.length ? (
					<div className="flex h-36 items-center justify-center text-muted-foreground">尚未加入渠道</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>渠道域名</TableHead>
								<TableHead>顯示名稱</TableHead>
								<TableHead className="w-16 text-center">刪除</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.map((ch) => (
								<ChannelRow key={ch.id} channel={ch} onDelete={() => del.mutate(ch.id)} isDeleting={del.isPending} />
							))}
						</TableBody>
					</Table>
				)}
			</div>

			<AddChannelDialog open={addOpen} onOpenChange={setAddOpen} />
		</div>
	);
}

function ChannelRow({ channel, onDelete, isDeleting }: { channel: Channel; onDelete: () => void; isDeleting: boolean }) {
	return (
		<TableRow>
			<TableCell className="font-medium">
				<div className="flex items-center gap-2">
					<Rss size={14} className="text-muted-foreground" />
					{channel.channel}
				</div>
			</TableCell>
			<TableCell className="text-sm text-muted-foreground">{channel.displayName ?? "—"}</TableCell>
			<TableCell>
				<div className="flex justify-center">
					<Button
						size="icon"
						variant="ghost"
						className="h-7 w-7 text-muted-foreground hover:text-destructive"
						onClick={onDelete}
						disabled={isDeleting}
					>
						<Trash2 size={13} />
					</Button>
				</div>
			</TableCell>
		</TableRow>
	);
}

function AddChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
	const qc = useQueryClient();
	const [channel, setChannel] = useState("");
	const [displayName, setDisplayName] = useState("");

	const add = useMutation({
		// SSRF allowlist write — must only be called via explicit user gesture (this dialog button)
		mutationFn: addChannel,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["channels"] });
			toast.success("渠道已加入");
			setChannel(""); setDisplayName("");
			onOpenChange(false);
		},
		onError: () => toast.error("新增失敗"),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader><DialogTitle>新增渠道</DialogTitle></DialogHeader>
				<div className="space-y-3">
					<Input placeholder="域名（如 example.com）" value={channel} onChange={(e) => setChannel(e.target.value)} />
					<Input placeholder="顯示名稱（選填）" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
					<Button
						onClick={() => add.mutate({ channel, displayName: displayName || undefined })}
						disabled={add.isPending || !channel.trim()}
					>
						{add.isPending ? "新增中…" : "確認"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
