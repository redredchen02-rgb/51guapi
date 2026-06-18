// 数据目录环境变量解析:新名 GUAPI_DATA_DIR 优先,旧名 PUBLISHER_DATA_DIR 作兼容 fallback。
// 单一出处——未来弃用旧名时只改此处。空串视为未设(沿用旧 `||` 语义)。
export function dataDirEnv(): string | undefined {
	return process.env.GUAPI_DATA_DIR || process.env.PUBLISHER_DATA_DIR;
}
