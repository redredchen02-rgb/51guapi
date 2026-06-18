import type { Channel } from "../../../lib/channel-client";
import { btn } from "./styles";

interface Props {
	channels: Channel[];
	newChannel: string;
	chanError: string;
	chanBusy: boolean;
	onNewChannelChange: (v: string) => void;
	onAddChannel: () => void;
	onDeleteChannel: (id: string) => void;
}

// 受控展示组件:渠道白名单(动态 SSRF allowlist)增删。state 全在 GossipView 主组件。
export function ChannelWhitelistPanel({
	channels,
	newChannel,
	chanError,
	chanBusy,
	onNewChannelChange,
	onAddChannel,
	onDeleteChannel,
}: Props) {
	return (
		<div
			style={{
				border: "1px solid #d9d9d9",
				borderRadius: 6,
				padding: 10,
				marginBottom: 12,
				background: "#fafafa",
			}}
		>
			<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
				可爬取渠道(白名单)
			</div>
			<div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 8 }}>
				只有列入此处的域名才能被爬取。入库前做 DNS/私网校验。
			</div>
			<div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
				<input
					type="text"
					placeholder="域名,如 51cg1.com(钉死 https)"
					value={newChannel}
					onChange={(e) => onNewChannelChange(e.target.value)}
					style={{
						flex: 1,
						padding: "4px 6px",
						fontSize: 12,
						border: "1px solid #d9d9d9",
						borderRadius: 4,
					}}
				/>
				<button
					type="button"
					onClick={() => onAddChannel()}
					disabled={chanBusy}
					style={{ ...btn, background: "#52c41a", color: "white" }}
				>
					{chanBusy ? "确认中…" : "确认新增"}
				</button>
			</div>
			{chanError && (
				<div style={{ fontSize: 12, color: "#cf1322", marginBottom: 6 }}>
					⚠ {chanError}
				</div>
			)}
			{channels.length === 0 ? (
				<div style={{ fontSize: 12, color: "#8c8c8c" }}>尚无渠道</div>
			) : (
				channels.map((c) => (
					<div
						key={c.id}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							fontSize: 12,
							padding: "2px 0",
						}}
					>
						<span style={{ flex: 1 }}>{c.hostname}</span>
						<button
							type="button"
							onClick={() => onDeleteChannel(c.id)}
							style={{ ...btn, background: "#fff1f0", color: "#cf1322" }}
						>
							移除
						</button>
					</div>
				))
			)}
		</div>
	);
}
