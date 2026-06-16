import { dirname, join } from "node:path";
import { JsonFileStore } from "../utils/json-store.js";

export interface GossipSiteConfig {
	id: string;
	name: string;
	listUrl: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface GossipSiteCreate {
	name: string;
	listUrl: string;
}

const DATA_DIR =
	process.env.PUBLISHER_DATA_DIR ||
	join(dirname(new URL(import.meta.url).pathname), "..", "data");
const GOSSIP_SITES_DIR = join(DATA_DIR, "gossip-sites");

const siteStore = new JsonFileStore<GossipSiteConfig>({
	dirPath: GOSSIP_SITES_DIR,
	updatedAtKey: "updatedAt",
});

export async function listGossipSites(): Promise<GossipSiteConfig[]> {
	return siteStore.list();
}

export async function getGossipSite(
	id: string,
): Promise<GossipSiteConfig | null> {
	return siteStore.read(id);
}

export async function saveGossipSite(config: GossipSiteConfig): Promise<void> {
	return siteStore.write(config);
}

export async function deleteGossipSite(id: string): Promise<boolean> {
	return siteStore.delete(id);
}
