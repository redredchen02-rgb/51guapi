// 数据目录环境变量解析。单一出处,空串视为未设。
export function dataDirEnv(): string | undefined {
	return process.env.GUAPI_DATA_DIR || undefined;
}
