// 运行时脱敏闸门(TS 端口,规则对齐 scripts/check-fixture-secrets.sh)。
// 用于轨迹落盘前清洗 DOM 快照:**fail-closed** —— 原始快照绝不在清洗+复核通过前落盘;
// 清洗后仍命中机密形态 → 拒绝存快照、报警(宁可不存,绝不漏存)。
//
// 诚实局限:正则清洗挡不住所有未知字段名的机密,是"结构化摘要优先 + 人工复核"之上的兜底。

// denylist:常见机密形态(对齐 shell 版,JWT 阈值 8)。
const DENYLIST =
	/Bearer\s+[A-Za-z0-9._-]+|Set-Cookie|JSESSIONID|PHPSESSID|csrf[_-]?token|_token|sessionid|session=|eyJ[A-Za-z0-9_-]{8,}|[A-Fa-f0-9]{32,}/i;

/** 清洗后的文本是否仍命中机密形态(投毒自检靠它)。 */
export function containsSecret(text: string): boolean {
	return DENYLIST.test(text);
}

/**
 * 清洗 DOM 快照字符串:
 *  - 整条删除 hidden input(含值);
 *  - 所有 value="..."/'...' → value=""(剥表单值,含可见域);
 *  - textarea 内容清空;
 *  - 删除 meta csrf/nonce 标签;
 *  - data-* 属性剥值;
 *  - Bearer/JWT/长 hex 子串 → [scrubbed]。
 */
export function scrubHtml(html: string): string {
	let out = html;
	// hidden input 整删(顺序无关:先匹配整个 <input ...> 再判 hidden)。
	out = out.replace(/<input\b[^>]*>/gi, (tag) =>
		/type\s*=\s*["']?hidden/i.test(tag) ? "" : tag,
	);
	// 表单值剥空。
	out = out.replace(/\bvalue\s*=\s*"(?:[^"\\]|\\.)*"/gi, 'value=""');
	out = out.replace(/\bvalue\s*=\s*'(?:[^'\\]|\\.)*'/gi, "value=''");
	// textarea 内容清空。
	out = out.replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, "$1$2");
	// meta csrf/nonce 删除。
	out = out.replace(/<meta\b[^>]*(?:csrf|nonce)[^>]*>/gi, "");
	// data-* 属性剥值。
	out = out.replace(
		/\bdata-[\w-]+\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gi,
		'data-x=""',
	);
	// 残留机密子串兜底替换。
	out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "[scrubbed]");
	out = out.replace(/eyJ[A-Za-z0-9_-]{8,}/g, "[scrubbed]");
	out = out.replace(/[A-Fa-f0-9]{32,}/g, "[scrubbed]");
	return out;
}

export interface ScrubResult {
	ok: boolean;
	/** 仅在 ok 时返回已清洗快照;ok:false 时绝不返回任何快照(fail-closed)。 */
	snapshot?: string;
	reason?: string;
}

/** 清洗 + 复核;清洗后仍命中机密 → fail-closed(不返回快照)。 */
export function scrubSnapshot(html: string): ScrubResult {
	const scrubbed = scrubHtml(html);
	if (containsSecret(scrubbed)) {
		return { ok: false, reason: "secret-detected-after-scrub" };
	}
	return { ok: true, snapshot: scrubbed };
}
