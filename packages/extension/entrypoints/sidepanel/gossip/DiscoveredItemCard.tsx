import type { DiscoveredItem } from "../../../lib/gossip-client";
import { btn } from "./styles";

interface Props {
	item: DiscoveredItem;
	genBusy: boolean;
	genError?: string;
	onGenerate: () => void;
}

function urlLabel(url: string): string {
	try {
		const u = new URL(url);
		const parts = u.pathname.split("/").filter(Boolean);
		return parts[parts.length - 1] ?? url;
	} catch {
		return url;
	}
}

// 受控展示组件:单篇发现文章行 + 生成按钮。生成逻辑(handleGenerate)留主组件。
export function DiscoveredItemCard({
	item,
	genBusy,
	genError,
	onGenerate,
}: Props) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "4px 0",
				borderBottom: "1px solid #f0f0f0",
				fontSize: 12,
			}}
		>
			<span
				style={{
					flex: 1,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{item.title ?? urlLabel(item.url)}
			</span>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-end",
					gap: 2,
				}}
			>
				<button
					type="button"
					onClick={() => onGenerate()}
					disabled={genBusy}
					style={{
						...btn,
						background: "#1677ff",
						color: "white",
						whiteSpace: "nowrap",
					}}
				>
					{genBusy ? "生成中…" : "生成文章"}
				</button>
				{genError && (
					<span style={{ fontSize: 10, color: "#cf1322" }}>⚠ {genError}</span>
				)}
			</div>
		</div>
	);
}
