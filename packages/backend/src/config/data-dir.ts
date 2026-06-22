// 数据目录环境变量解析:新名 GUAPI_DATA_DIR 优先,旧名 PUBLISHER_DATA_DIR 作兼容 fallback。
// 单一出处——未来弃用旧名时只改此处。空串视为未设(沿用旧 `||` 语义)。

// 仅在「只命中 legacy 旧名」时打印一次弃用提醒;进程内只警告一次,避免每次解析刷屏。
let legacyWarned = false;

export function dataDirEnv(): string | undefined {
	const next = process.env.GUAPI_DATA_DIR;
	const legacy = process.env.PUBLISHER_DATA_DIR;
	// `||` 让空串落到 legacy(沿用旧语义);仅当新名未设而 legacy 命中时才提醒。
	if (!next && legacy && !legacyWarned) {
		legacyWarned = true;
		console.warn(
			"[data-dir] PUBLISHER_DATA_DIR is deprecated; rename it to GUAPI_DATA_DIR.",
		);
	}
	return next || legacy;
}
