import type { ThemeCount } from "../../../lib/pending-client";

interface Props {
	themes: ThemeCount[];
	/** 当前选中题材；null=全部。 */
	selected: string | null;
	onSelect: (theme: string | null) => void;
	loading?: boolean;
}

// 受控展示组件:题材选择器（U5）。「全部」+ 每个题材一个 chip（带计数）。
// 空态（无已核对的瓜）给引导文案;选中态高亮。题材数据来自 /pending-topics/themes（仅已核对）。
export function ThemePicker({ themes, selected, onSelect, loading }: Props) {
	if (loading) {
		return (
			<div
				className="text-xs text-muted"
				style={{ margin: "var(--space-sm) 0" }}
			>
				题材加载中…
			</div>
		);
	}
	if (themes.length === 0) {
		return (
			<div
				className="text-xs text-muted"
				style={{ margin: "var(--space-sm) 0" }}
				data-testid="theme-picker-empty"
			>
				暂无已核对的瓜——先在下方逐条核对（确认）后，这里才会出现可选题材。
			</div>
		);
	}

	const chip = (
		key: string,
		label: string,
		active: boolean,
		onClick: () => void,
	) => (
		<button
			key={key}
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className="btn btn-sm"
			style={{
				fontSize: "var(--font-xs)",
				borderRadius: 999,
				padding: "1px 10px",
				background: active ? "var(--color-primary, #1677ff)" : "transparent",
				color: active ? "#fff" : "var(--color-text)",
				border: `1px solid ${active ? "var(--color-primary, #1677ff)" : "var(--color-border-lighter)"}`,
			}}
		>
			{label}
		</button>
	);

	return (
		<div
			data-testid="theme-picker"
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: 6,
				margin: "var(--space-sm) 0 var(--space-md)",
			}}
		>
			{chip("__all__", "全部", selected === null, () => onSelect(null))}
			{themes.map((t) =>
				chip(t.theme, `${t.theme} ${t.count}`, selected === t.theme, () =>
					onSelect(t.theme),
				),
			)}
		</div>
	);
}
