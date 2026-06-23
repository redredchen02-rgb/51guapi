import { KeyboardShortcutsHelp } from "../components/KeyboardShortcutsHelp";

interface Props {
	onOpenSettings: () => void;
	onToggleLogs: () => void;
	onOpenGossip: () => void;
	onOpenPending: () => void;
	onOpenMetrics: () => void;
}

// 受控展示组件:主视图头部(标题 + 设置/快捷键/日志按钮 + 工作流导航卡片)。
export function MainHeader({
	onOpenSettings,
	onToggleLogs,
	onOpenGossip,
	onOpenPending,
	onOpenMetrics,
}: Props) {
	return (
		<header className="app-header">
			<div className="app-title-row">
				<div>
					<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>吃瓜小帮手</h1>
					<div className="text-sm text-secondary" style={{ marginTop: 3 }}>
						抓取选题 → AI 生成草稿 → 预览编辑 → 导出
					</div>
				</div>
				<div className="app-actions">
					<button
						type="button"
						onClick={onOpenSettings}
						className="btn btn-plain btn-sm"
						aria-label="设置"
					>
						⚙ 设置
					</button>
					<KeyboardShortcutsHelp />
					<button
						type="button"
						onClick={onToggleLogs}
						className="btn btn-plain btn-sm"
						aria-label="错误日志"
					>
						📋 日志
					</button>
				</div>
			</div>

			<nav className="workflow-grid" aria-label="主要工作流">
				<button
					type="button"
					onClick={onOpenGossip}
					className="workflow-card primary"
				>
					<span className="workflow-card-title">吃瓜素材</span>
					<span className="workflow-card-desc">
						抓取来源、提炼事实,进入待审池
					</span>
				</button>
				<button type="button" onClick={onOpenPending} className="workflow-card">
					<span className="workflow-card-title">待审池</span>
					<span className="workflow-card-desc">
						补事实、批准 → AI 草稿 → 导出
					</span>
				</button>
				<button type="button" onClick={onOpenMetrics} className="workflow-card">
					<span className="workflow-card-title">数据指标</span>
					<span className="workflow-card-desc">
						抓取成功率、草稿生成率、验证关统计
					</span>
				</button>
			</nav>
		</header>
	);
}
