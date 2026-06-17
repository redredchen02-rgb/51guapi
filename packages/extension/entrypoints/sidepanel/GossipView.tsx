import { useCallback, useEffect, useState } from "react";
import {
	type Channel,
	createChannel,
	deleteChannel,
	fetchChannels,
} from "../../lib/channel-client";
import {
	createGossipSite,
	type DiscoveredItem,
	deleteGossipSite,
	discoverGossipSite,
	fetchGossipSites,
	fetchGossipTopicFromUrl,
	type GossipSite,
} from "../../lib/gossip-client";

interface Props {
	onBack: () => void;
	onTopicAdded: () => void; // 跳轉到 pending 頁
}

const btn: React.CSSProperties = {
	padding: "5px 10px",
	fontSize: 12,
	border: "none",
	borderRadius: 4,
	cursor: "pointer",
};

export function GossipView({ onBack, onTopicAdded }: Props) {
	const [sites, setSites] = useState<GossipSite[]>([]);
	const [newName, setNewName] = useState("");
	const [newUrl, setNewUrl] = useState("");
	const [addError, setAddError] = useState("");
	const [addBusy, setAddBusy] = useState(false);
	const [addWarning, setAddWarning] = useState<{
		hostname: string;
		proceed: () => Promise<void>;
	} | null>(null);

	// U6 渠道白名单(动态 SSRF allowlist)。
	const [channels, setChannels] = useState<Channel[]>([]);
	const [newChannel, setNewChannel] = useState("");
	const [chanPassword, setChanPassword] = useState("");
	const [chanError, setChanError] = useState("");
	const [chanBusy, setChanBusy] = useState(false);

	// per-site 的 discover 結果和狀態
	const [discovered, setDiscovered] = useState<
		Record<string, DiscoveredItem[]>
	>({});
	const [discoverBusy, setDiscoverBusy] = useState<Record<string, boolean>>({});
	const [discoverError, setDiscoverError] = useState<Record<string, string>>(
		{},
	);

	// per-article 的生成狀態
	const [genBusy, setGenBusy] = useState<Record<string, boolean>>({});
	const [genError, setGenError] = useState<Record<string, string>>({});

	const loadSites = useCallback(async () => {
		const list = await fetchGossipSites();
		setSites(list);
	}, []);

	const loadChannels = useCallback(async () => {
		try {
			setChannels(await fetchChannels());
		} catch {
			// 后端不可达时静默(本地仍可工作)。
		}
	}, []);

	useEffect(() => {
		void loadSites();
		void loadChannels();
	}, [loadSites, loadChannels]);

	async function handleAddChannel() {
		if (!newChannel.trim()) {
			setChanError("请填写渠道域名");
			return;
		}
		if (!chanPassword) {
			setChanError("新增渠道需管理员口令重验");
			return;
		}
		setChanBusy(true);
		setChanError("");
		try {
			await createChannel(newChannel.trim(), { adminPassword: chanPassword });
			setNewChannel("");
			setChanPassword("");
			await loadChannels();
		} catch (e) {
			setChanError(e instanceof Error ? e.message : "新增渠道失败");
		} finally {
			setChanBusy(false);
		}
	}

	async function handleDeleteChannel(id: string) {
		try {
			await deleteChannel(id);
			setChannels((prev) => prev.filter((c) => c.id !== id));
		} catch (e) {
			setChanError(e instanceof Error ? e.message : "删除渠道失败");
		}
	}

	async function doCreateSite(name: string, url: string) {
		setAddBusy(true);
		setAddError("");
		try {
			await createGossipSite(name, url);
			setNewName("");
			setNewUrl("");
			setAddWarning(null);
			await loadSites();
		} catch (e) {
			setAddError(e instanceof Error ? e.message : "新增失敗");
		} finally {
			setAddBusy(false);
		}
	}

	async function handleAdd() {
		if (!newName.trim() || !newUrl.trim()) {
			setAddError("請填寫站點名稱和 URL");
			return;
		}
		setAddError("");
		setAddWarning(null);

		let hostname: string;
		try {
			hostname = new URL(newUrl.trim()).hostname;
		} catch {
			setAddError("站点 URL 无效，请检查格式");
			return;
		}

		const inWhitelist = channels.some((c) => c.hostname === hostname);
		if (!inWhitelist) {
			const name = newName.trim();
			const url = newUrl.trim();
			setAddWarning({
				hostname,
				proceed: () => doCreateSite(name, url),
			});
			return;
		}

		await doCreateSite(newName.trim(), newUrl.trim());
	}

	async function handleDelete(id: string) {
		try {
			await deleteGossipSite(id);
			setSites((prev) => prev.filter((s) => s.id !== id));
			setDiscovered((prev) => {
				const n = { ...prev };
				delete n[id];
				return n;
			});
		} catch (e) {
			setAddError(e instanceof Error ? e.message : "刪除失敗");
		}
	}

	async function handleDiscover(site: GossipSite) {
		setDiscoverBusy((p) => ({ ...p, [site.id]: true }));
		setDiscoverError((p) => {
			const n = { ...p };
			delete n[site.id];
			return n;
		});
		try {
			const items = await discoverGossipSite(site.id);
			setDiscovered((p) => ({ ...p, [site.id]: items }));
		} catch (e) {
			setDiscoverError((p) => ({
				...p,
				[site.id]: e instanceof Error ? e.message : "發現失敗",
			}));
		} finally {
			setDiscoverBusy((p) => ({ ...p, [site.id]: false }));
		}
	}

	async function handleGenerate(
		item: DiscoveredItem,
		siteId: string,
		siteName: string,
	) {
		const key = item.url;
		setGenBusy((p) => ({ ...p, [key]: true }));
		setGenError((p) => {
			const n = { ...p };
			delete n[key];
			return n;
		});
		try {
			await fetchGossipTopicFromUrl(item.url, siteName);
			setDiscovered((p) => ({
				...p,
				[siteId]: (p[siteId] ?? []).filter((i) => i.url !== item.url),
			}));
			onTopicAdded();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg === "DUPLICATE_URL") {
				setDiscovered((p) => ({
					...p,
					[siteId]: (p[siteId] ?? []).filter((i) => i.url !== item.url),
				}));
				onTopicAdded();
			} else {
				setGenError((p) => ({ ...p, [key]: msg }));
			}
		} finally {
			setGenBusy((p) => ({ ...p, [key]: false }));
		}
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

	return (
		<div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginBottom: 12,
				}}
			>
				<button type="button" onClick={onBack} style={btn}>
					← 返回
				</button>
				<h2 style={{ margin: 0, fontSize: 15 }}>吃瓜素材</h2>
			</div>

			{/* U6 可爬取渠道(白名单) */}
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
					只有列入此处的域名才能被爬取。新增即需操作者确认,入库前做
					DNS/私网校验。
				</div>
				<div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
					<input
						type="text"
						placeholder="域名,如 51cg1.com(钉死 https)"
						value={newChannel}
						onChange={(e) => setNewChannel(e.target.value)}
						style={{
							flex: 1,
							padding: "4px 6px",
							fontSize: 12,
							border: "1px solid #d9d9d9",
							borderRadius: 4,
						}}
					/>
					<input
						type="password"
						placeholder="管理员口令(step-up)"
						value={chanPassword}
						onChange={(e) => setChanPassword(e.target.value)}
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
						onClick={() => void handleAddChannel()}
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
								onClick={() => void handleDeleteChannel(c.id)}
								style={{ ...btn, background: "#fff1f0", color: "#cf1322" }}
							>
								移除
							</button>
						</div>
					))
				)}
			</div>

			{/* 新增站點 */}
			<div
				style={{
					border: "1px solid #d9d9d9",
					borderRadius: 6,
					padding: 10,
					marginBottom: 12,
				}}
			>
				<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
					新增站點
				</div>
				<div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
					<input
						type="text"
						placeholder="站點名稱"
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						style={{
							flex: 1,
							padding: "4px 6px",
							fontSize: 12,
							border: "1px solid #d9d9d9",
							borderRadius: 4,
						}}
					/>
					<input
						type="url"
						placeholder="清單頁 URL (https://...)"
						value={newUrl}
						onChange={(e) => setNewUrl(e.target.value)}
						style={{
							flex: 2,
							padding: "4px 6px",
							fontSize: 12,
							border: "1px solid #d9d9d9",
							borderRadius: 4,
						}}
					/>
					<button
						type="button"
						onClick={() => void handleAdd()}
						disabled={addBusy}
						style={{ ...btn, background: "#1677ff", color: "white" }}
					>
						{addBusy ? "新增中…" : "新增"}
					</button>
				</div>
				{addError && (
					<div style={{ fontSize: 12, color: "#cf1322" }}>{addError}</div>
				)}
				{addWarning && (
					<div
						role="status"
						style={{
							marginTop: 6,
							padding: "8px 10px",
							background: "#fffbe6",
							border: "1px solid #ffe58f",
							borderRadius: 4,
							fontSize: 12,
							color: "#7c4d00",
						}}
					>
						<div style={{ marginBottom: 6 }}>
							⚠ 域名 <strong>{addWarning.hostname}</strong>{" "}
							未在渠道白名单，此站点爬取将被 SSRF
							守卫拒绝。建议先在上方「可爬取渠道」中添加 {addWarning.hostname}。
						</div>
						<div style={{ display: "flex", gap: 8 }}>
							<button
								type="button"
								onClick={() => void addWarning.proceed()}
								disabled={addBusy}
								style={{ ...btn, background: "#faad14", color: "white" }}
							>
								仍然继续
							</button>
							<button
								type="button"
								onClick={() => setAddWarning(null)}
								style={{ ...btn, background: "#f0f0f0" }}
							>
								取消
							</button>
						</div>
					</div>
				)}
			</div>

			{/* 站點清單 */}
			{sites.length === 0 ? (
				<div
					style={{
						color: "#8c8c8c",
						fontSize: 13,
						textAlign: "center",
						padding: 20,
					}}
				>
					尚未新增站點，請在上方填寫後點「新增」
				</div>
			) : (
				sites.map((site) => (
					<div
						key={site.id}
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
								onClick={() => void handleDiscover(site)}
								disabled={discoverBusy[site.id]}
								style={{ ...btn, background: "#f0f0f0" }}
							>
								{discoverBusy[site.id] ? "抓取中…" : "🔄 刷新"}
							</button>
							<button
								type="button"
								onClick={() => void handleDelete(site.id)}
								style={{ ...btn, background: "#fff1f0", color: "#cf1322" }}
							>
								刪除
							</button>
						</div>

						{discoverError[site.id] && (
							<div style={{ fontSize: 12, color: "#cf1322", marginBottom: 6 }}>
								⚠ {discoverError[site.id]}
							</div>
						)}

						{discovered[site.id] === undefined && !discoverBusy[site.id] && (
							<div style={{ fontSize: 12, color: "#8c8c8c" }}>
								點「刷新」發現最新素材
							</div>
						)}

						{discovered[site.id]?.length === 0 && (
							<div style={{ fontSize: 12, color: "#8c8c8c" }}>
								未發現新素材（可能已全部加入待審）
							</div>
						)}

						{(discovered[site.id] ?? []).map((item) => (
							<div
								key={item.url}
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
										onClick={() =>
											void handleGenerate(item, site.id, site.name)
										}
										disabled={genBusy[item.url]}
										style={{
											...btn,
											background: "#1677ff",
											color: "white",
											whiteSpace: "nowrap",
										}}
									>
										{genBusy[item.url] ? "生成中…" : "生成文章"}
									</button>
									{genError[item.url] && (
										<span style={{ fontSize: 10, color: "#cf1322" }}>
											⚠ {genError[item.url]}
										</span>
									)}
								</div>
							</div>
						))}
					</div>
				))
			)}
		</div>
	);
}
