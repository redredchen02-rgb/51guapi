// 文章标签校验：规范八，3-5 个标签，禁营销词。

export const MARKETING_WORD_BLOCKLIST: readonly string[] = [
	"爆款",
	"必看",
	"炸裂",
	"刺激到不行",
	"最好看",
	"顶级",
	"神仙",
] as const;

export interface TagValidationResult {
	ok: boolean;
	errors: string[];
}

/** 校验文章标签：数量（3-5）+ 营销词阻断。errors 为空时 ok=true。 */
export function validateArticleTags(tags: string[]): TagValidationResult {
	const errors: string[] = [];
	if (tags.length < 3)
		errors.push(`标签数量不足 3 个（当前 ${tags.length} 个）`);
	if (tags.length > 5)
		errors.push(`标签数量超过 5 个（当前 ${tags.length} 个）`);
	for (const tag of tags) {
		for (const blocked of MARKETING_WORD_BLOCKLIST) {
			if (tag.includes(blocked)) {
				errors.push(`含营销词"${blocked}"：${tag}`);
			}
		}
	}
	return { ok: errors.length === 0, errors };
}
