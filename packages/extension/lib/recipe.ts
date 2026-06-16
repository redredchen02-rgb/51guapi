import type { FieldMapping } from "@51guapi/shared";
import { DEFAULT_FIELD_MAPPING } from "@51guapi/shared";

// 站点知识"配方"——把分散的硬编码(字段选择器 / 脱敏白名单 / 发布配置 / 漂移选择器集)
// 合并成**单一数据源**。纯数据,不 import `#imports`/chrome,扩展与(未来)无头端都能消费。
//
// v1 只做**数据合并**;执行策略抽象(RecipeExecutor)延后到第二个消费者(无头 B)真出现
// —— 当前只一个消费者 = 投机抽象,不做(见计划 Scope)。

export interface SiteRecipe {
	/** 站点 host(信息性;授权判定仍在 background 闸门,不靠这里)。 */
	host: string;
	/** 字段选择器映射(单一事实源 = DEFAULT_FIELD_MAPPING,recipe 不另存一份防分叉)。 */
	fieldMapping: FieldMapping;
	/** 发布配置。 */
	publish: {
		saveEndpoint: string;
		editorSelector: string;
		formSelector: string;
	};
	/** 正文消毒白名单(DOMPurify)。 */
	sanitize: {
		allowedTags: string[];
		allowedAttr: string[];
	};
}

// 正文消毒白名单(从 lib/sanitize.ts 迁来,recipe 现为唯一来源)。
const ALLOWED_TAGS = [
	"p",
	"br",
	"span",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"a",
	"ul",
	"ol",
	"li",
	"blockquote",
	"pre",
	"code",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"img",
];
const ALLOWED_ATTR = ["href", "target", "rel", "src", "alt"];

export const DEFAULT_RECIPE: SiteRecipe = {
	host: "dx-999-adm.ympxbys.xyz",
	fieldMapping: DEFAULT_FIELD_MAPPING,
	publish: {
		saveEndpoint: "/admin/webarticle/save",
		editorSelector: "#editor",
		formSelector: "form[lay-filter], form",
	},
	sanitize: {
		allowedTags: ALLOWED_TAGS,
		allowedAttr: ALLOWED_ATTR,
	},
};
