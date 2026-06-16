import type { FieldMapping, FieldType } from "./types.js";

export const VALID_FIELD_TYPES: readonly FieldType[] = [
	"text",
	"textarea",
	"quill",
	"native-select",
	"checkbox-multi",
	"date",
	"custom-dropdown",
	"tag-input",
] as const;

const VALID_FIELD_TYPES_SET = new Set<string>(VALID_FIELD_TYPES);

export function isValidFieldMapping(v: unknown): v is FieldMapping {
	if (!v || typeof v !== "object" || Array.isArray(v)) return false;
	for (const [, def] of Object.entries(v as Record<string, unknown>)) {
		if (!def || typeof def !== "object") return false;
		const d = def as Record<string, unknown>;
		if (typeof d.selector !== "string" || d.selector.trim() === "")
			return false;
		if (!VALID_FIELD_TYPES_SET.has(d.fieldType as string)) return false;
	}
	return true;
}

// 默认字段映射:来自 U0 现场勘查(docs/field-mapping-guide.md)。
// 刻意独立于 storage.ts —— 不依赖 `#imports`(WXT 虚拟模块),
// 这样 e2e / contract 测试能在无 WxtVitest 的环境直接 import,作选择器单一事实源。
// Migrated from packages/extension/lib/field-mapping.ts (identical to packages/backend/src/shared/field-mapping.ts)
export const DEFAULT_FIELD_MAPPING: FieldMapping = {
	title: { selector: 'input[name="title"]', fieldType: "text", label: "標題" },
	subtitle: {
		selector: 'input[name="subtitle"]',
		fieldType: "text",
		label: "副標題",
	},
	category: {
		selector: 'select[name="type"]',
		fieldType: "native-select",
		label: "類型",
	},
	body: { selector: "#editor", fieldType: "quill", label: "文章内容" },
	tags: {
		selector: 'input[name="tags[]"]',
		fieldType: "checkbox-multi",
		label: "標籤",
	},
	description: {
		selector: 'textarea[name="description"]',
		fieldType: "textarea",
		label: "描述",
	},
	postStatus: {
		selector: 'select[name="status"]',
		fieldType: "native-select",
		label: "狀態",
	},
	publishedAt: {
		selector: 'input[name="published_at"]',
		fieldType: "date",
		label: "發佈時間",
	},
	mediaId: {
		selector: 'input[name="media_id"]',
		fieldType: "text",
		label: "作品 id",
	},
	coverUrl: {
		selector: 'input[name="cover_url"]',
		fieldType: "text",
		label: "封面 URL",
	},
};
