import {
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export interface JsonFileStoreOptions<T> {
	dirPath: string;
	sanitize?: (id: string) => string;
	updatedAtKey?: keyof T;
}

function defaultSanitize(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class JsonFileStore<T extends { id: string }> {
	private readonly dirPath: string;
	private readonly sanitize: (id: string) => string;
	private readonly updatedAtKey: keyof T;

	constructor(options: JsonFileStoreOptions<T>) {
		this.dirPath = options.dirPath;
		this.sanitize = options.sanitize ?? defaultSanitize;
		this.updatedAtKey = (options.updatedAtKey ?? "updatedAt") as keyof T;
	}

	private filePath(id: string): string {
		const safe = this.sanitize(id);
		return join(this.dirPath, `${safe}.json`);
	}

	private async ensureDir(): Promise<void> {
		await mkdir(this.dirPath, { recursive: true });
	}

	async read(id: string): Promise<T | null> {
		const fp = this.filePath(id);
		try {
			const raw = await readFile(fp, "utf-8");
			return JSON.parse(raw) as T;
		} catch {
			return null;
		}
	}

	async write(data: T): Promise<void> {
		await this.ensureDir();
		(data as Record<string, unknown>)[this.updatedAtKey as string] =
			new Date().toISOString();
		await writeFile(
			this.filePath(data.id),
			JSON.stringify(data, null, 2),
			"utf-8",
		);
	}

	async delete(id: string): Promise<boolean> {
		const fp = this.filePath(id);
		try {
			await unlink(fp);
			return true;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw e;
		}
	}

	async list(opts?: { limit?: number }): Promise<T[]> {
		await this.ensureDir();
		const files = await readdir(this.dirPath);
		const jsonFiles = files.filter((f) => f.endsWith(".json"));

		// Optimization: stat files to get modification times, sort by mtime
		// Then only read the top N files needed for the limit
		type FileInfo = { name: string; mtime: number };
		const fileInfos: FileInfo[] = [];

		// Parallel stat all files
		const statResults = await Promise.allSettled(
			jsonFiles.map(async (f) => {
				const filePath = join(this.dirPath, f);
				const s = await stat(filePath);
				return { name: f, mtime: s.mtimeMs };
			}),
		);

		for (const result of statResults) {
			if (result.status === "fulfilled") {
				fileInfos.push(result.value);
			}
		}

		// Sort by modification time (newest first)
		fileInfos.sort((a, b) => b.mtime - a.mtime);

		// If limit specified, only read that many files
		const filesToRead = opts?.limit
			? fileInfos.slice(0, opts.limit)
			: fileInfos;

		// Parallel read all files
		const readResults = await Promise.allSettled(
			filesToRead.map(async (fi) => {
				const raw = await readFile(join(this.dirPath, fi.name), "utf-8");
				return JSON.parse(raw) as T;
			}),
		);

		const items: T[] = [];
		for (const result of readResults) {
			if (result.status === "fulfilled") {
				items.push(result.value);
			}
		}

		return items;
	}
}
