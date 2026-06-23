import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Globe, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	addGossipSite,
	deleteGossipSite,
	discoverGossipSite,
	type GossipSite,
	listGossipSites,
} from "@/api/gossip";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/sites")({
	component: SitesPage,
});

function SitesPage() {
	const qc = useQueryClient();
	const [addOpen, setAddOpen] = useState(false);

	const { data, isLoading } = useQuery({
		queryKey: ["gossip-sites"],
		queryFn: listGossipSites,
		select: (d) => d.sites,
	});

	const del = useMutation({
		mutationFn: deleteGossipSite,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["gossip-sites"] });
			toast.success("已刪除");
		},
		onError: () => toast.error("刪除失敗"),
	});

	const discover = useMutation({
		mutationFn: discoverGossipSite,
		onSuccess: (res) => {
			qc.invalidateQueries({ queryKey: ["pending-topics"] });
			toast.success(`發現 ${res.discovered ?? 0} 篇新選題`);
		},
		onError: () => toast.error("探索失敗"),
	});

	return (
		<div className="p-6 space-y-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">已加入的吃瓜站點</p>
				<Button size="sm" onClick={() => setAddOpen(true)}>
					<Plus size={14} className="mr-1.5" />
					新增站點
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
					<div className="flex h-36 items-center justify-center text-muted-foreground">
						尚未加入站點
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>站點名稱</TableHead>
								<TableHead>列表 URL</TableHead>
								<TableHead className="w-28 text-center">操作</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.map((site) => (
								<SiteRow
									key={site.id}
									site={site}
									onDelete={() => del.mutate(site.id)}
									onDiscover={() => discover.mutate(site.id)}
									isDeleting={del.isPending}
									isDiscovering={discover.isPending}
								/>
							))}
						</TableBody>
					</Table>
				)}
			</div>

			<AddSiteDialog open={addOpen} onOpenChange={setAddOpen} />
		</div>
	);
}

function SiteRow({
	site,
	onDelete,
	onDiscover,
	isDeleting,
	isDiscovering,
}: {
	site: GossipSite;
	onDelete: () => void;
	onDiscover: () => void;
	isDeleting: boolean;
	isDiscovering: boolean;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">
				<div className="flex items-center gap-2">
					<Globe size={14} className="text-muted-foreground" />
					{site.name}
				</div>
			</TableCell>
			<TableCell className="max-w-xs truncate text-sm text-muted-foreground">
				{site.listUrl}
			</TableCell>
			<TableCell>
				<div className="flex items-center justify-center gap-1">
					<Button
						size="icon"
						variant="ghost"
						className="h-7 w-7 text-primary"
						title="探索新選題"
						onClick={onDiscover}
						disabled={isDiscovering}
					>
						<Zap size={13} />
					</Button>
					<Button
						size="icon"
						variant="ghost"
						className="h-7 w-7 text-muted-foreground hover:text-destructive"
						title="刪除"
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

function AddSiteDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const qc = useQueryClient();
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");

	const add = useMutation({
		mutationFn: addGossipSite,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["gossip-sites"] });
			toast.success("站點已加入");
			setName("");
			setUrl("");
			onOpenChange(false);
		},
		onError: () => toast.error("新增失敗"),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>新增站點</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					<Input
						placeholder="站點名稱"
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
					<Input
						placeholder="列表頁 URL"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
					/>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						onClick={() => add.mutate({ name, listUrl: url })}
						disabled={add.isPending || !name.trim() || !url.trim()}
					>
						{add.isPending ? "新增中…" : "確認"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
