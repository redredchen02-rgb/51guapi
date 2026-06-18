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
import { AddSiteForm } from "./gossip/AddSiteForm";
import { ChannelWhitelistPanel } from "./gossip/ChannelWhitelistPanel";
import { SiteCard } from "./gossip/SiteCard";
import { btn } from "./gossip/styles";

interface Props {
	onBack: () => void;
	onTopicAdded: () => void; // 跳轉到 pending 頁
}

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
		try {
			const list = await fetchGossipSites();
			setSites(list);
		} catch {
			// 401 / 网络错误时保持现有列表，不崩溃
		}
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
			setDiscoverError((p) => ({
				...p,
				[id]: e instanceof Error ? e.message : "刪除失敗",
			}));
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

			<ChannelWhitelistPanel
				channels={channels}
				newChannel={newChannel}
				chanPassword={chanPassword}
				chanError={chanError}
				chanBusy={chanBusy}
				onNewChannelChange={setNewChannel}
				onChanPasswordChange={setChanPassword}
				onAddChannel={() => void handleAddChannel()}
				onDeleteChannel={(id) => void handleDeleteChannel(id)}
			/>

			<AddSiteForm
				newName={newName}
				newUrl={newUrl}
				addError={addError}
				addBusy={addBusy}
				addWarning={addWarning}
				onNewNameChange={setNewName}
				onNewUrlChange={setNewUrl}
				onAdd={() => void handleAdd()}
				onProceed={() => void addWarning?.proceed()}
				onCancelWarning={() => setAddWarning(null)}
			/>

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
					<SiteCard
						key={site.id}
						site={site}
						items={discovered[site.id]}
						discoverBusy={discoverBusy[site.id] ?? false}
						discoverError={discoverError[site.id]}
						genBusy={genBusy}
						genError={genError}
						onDiscover={() => void handleDiscover(site)}
						onDelete={() => void handleDelete(site.id)}
						onGenerate={(item) => void handleGenerate(item, site.id, site.name)}
					/>
				))
			)}
		</div>
	);
}
