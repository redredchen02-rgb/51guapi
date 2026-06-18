import type { DiscoveredItem, GossipSite } from "../../../lib/gossip-client";
import { DiscoveredItemCard } from "./DiscoveredItemCard";
import { btn } from "./styles";

interface Props {
	site: GossipSite;
	items: DiscoveredItem[] | undefined;
	discoverBusy: boolean;
	discoverError?: string;
	genBusy: Record<string, boolean>;
	genError: Record<string, string>;
	onDiscover: () => void;
	onDelete: () => void;
	onGenerate: (item: DiscoveredItem) => void;
}

// 受控展示组件:单站点卡(头部操作 + 发现素材列表)。state 全在 GossipView 主组件。
export function SiteCard({
	site,
	items,
	discoverBusy,
	discoverError,
	genBusy,
	genError,
	onDiscover,
	onDelete,
	onGenerate,
}: Props) {
	return (
		<div
			style={{
				border: "1px solid #d9d9d9",
				borderRadius: 6,
				padding: 10,
				marginBottom: 10,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					marginBottom: 8,
				}}
			>
				<span style={{ fontWeight: 600, fontSize: 13 }}>{site.name}</span>
				<span
					style={{
						fontSize: 11,
						color: "#8c8c8c",
						flex: 1,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{site.listUrl}
				</span>
				<button
					type="button"
					onClick={() => onDiscover()}
					disabled={discoverBusy}
					style={{ ...btn, background: "#f0f0f0" }}
				>
					{discoverBusy ? "抓取中…" : "🔄 刷新"}
				</button>
				<button
					type="button"
					onClick={() => onDelete()}
					style={{ ...btn, background: "#fff1f0", color: "#cf1322" }}
				>
					刪除
				</button>
			</div>

			{discoverError && (
				<div style={{ fontSize: 12, color: "#cf1322", marginBottom: 6 }}>
					⚠ {discoverError}
				</div>
			)}

			{items === undefined && !discoverBusy && (
				<div style={{ fontSize: 12, color: "#8c8c8c" }}>
					點「刷新」發現最新素材
				</div>
			)}

			{items?.length === 0 && (
				<div style={{ fontSize: 12, color: "#8c8c8c" }}>
					未發現新素材（可能已全部加入待審）
				</div>
			)}

			{(items ?? []).map((item) => (
				<DiscoveredItemCard
					key={item.url}
					item={item}
					genBusy={genBusy[item.url] ?? false}
					genError={genError[item.url]}
					onGenerate={() => onGenerate(item)}
				/>
			))}
		</div>
	);
}
