import type { VerificationResult } from "@51guapi/shared";

interface Props {
	verification?: VerificationResult;
	verifiedAt?: string;
}

interface Chip {
	icon: string;
	label: string;
	color: string;
	title?: string;
}

// 受控展示组件:入池前验证关结果的徽章条（U4）。
// 文字 + 图标双编码（非纯颜色），满足无障碍;图例见各 chip 的 label/title。
// 软标 flag 用警告色、已核对/通过用成功色、未溯源/疑似重复用错误色。
export function VerificationBadge({ verification, verifiedAt }: Props) {
	if (!verification && !verifiedAt) return null;
	const chips: Chip[] = [];

	if (verifiedAt) {
		chips.push({
			icon: "✅",
			label: "已核对",
			color: "var(--color-success)",
			title: `人工核对于 ${verifiedAt}`,
		});
	}

	const v = verification;
	if (v) {
		if (v.decision === "pass" && !verifiedAt) {
			chips.push({
				icon: "✓",
				label: "验证通过",
				color: "var(--color-success)",
			});
		}
		if (v.decision === "flag") {
			chips.push({
				icon: "⚑",
				label: "待核对",
				color: "var(--color-warning)",
				title: v.reasons.join("；"),
			});
		}
		if (v.grounding && !v.grounding.ok && v.grounding.unsourced.length > 0) {
			chips.push({
				icon: "⛔",
				label: `未溯源:${v.grounding.unsourced.join("、")}`,
				color: "var(--color-error, #cf1322)",
				title: "这些字段在原文中找不到出处，请人工核对",
			});
		}
		if (v.freshness?.unknown) {
			chips.push({
				icon: "🕓",
				label: "时间未知",
				color: "var(--color-text-disabled)",
				title: "未解析到发布时间，新鲜度按中性处理",
			});
		} else if (v.freshness && !v.freshness.ok) {
			chips.push({
				icon: "🕓",
				label: "超时间窗",
				color: "var(--color-warning)",
			});
		}
		if (v.suspectedDuplicate) {
			chips.push({
				icon: "⧉",
				label: "疑似重复",
				color: "var(--color-error, #cf1322)",
				title: "内容指纹命中已有条目，可能是转载",
			});
		}
	}

	if (chips.length === 0) return null;

	return (
		<div
			data-testid="verification-badge"
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: 4,
				marginTop: "var(--space-xs)",
			}}
		>
			{chips.map((c) => (
				<span
					key={c.label}
					title={c.title}
					style={{
						fontSize: "var(--font-xs)",
						border: `1px solid ${c.color}`,
						color: c.color,
						padding: "0 5px",
						borderRadius: 4,
						whiteSpace: "nowrap",
					}}
				>
					{c.icon} {c.label}
				</span>
			))}
		</div>
	);
}
