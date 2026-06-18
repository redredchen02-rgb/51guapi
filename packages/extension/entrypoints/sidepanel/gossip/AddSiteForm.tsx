import { btn } from "./styles";

export interface AddSiteWarning {
	hostname: string;
	proceed: () => Promise<void>;
}

interface Props {
	newName: string;
	newUrl: string;
	addError: string;
	addBusy: boolean;
	addWarning: AddSiteWarning | null;
	onNewNameChange: (v: string) => void;
	onNewUrlChange: (v: string) => void;
	onAdd: () => void;
	onProceed: () => void;
	onCancelWarning: () => void;
}

// 受控展示组件:新增站点表单 + 白名单 warning 分支。
// 校验逻辑(空值/URL 解析/白名单判断)留在 GossipView 主组件的 handleAdd。
export function AddSiteForm({
	newName,
	newUrl,
	addError,
	addBusy,
	addWarning,
	onNewNameChange,
	onNewUrlChange,
	onAdd,
	onProceed,
	onCancelWarning,
}: Props) {
	return (
		<div
			style={{
				border: "1px solid #d9d9d9",
				borderRadius: 6,
				padding: 10,
				marginBottom: 12,
			}}
		>
			<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
				新增站點
			</div>
			<div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
				<input
					type="text"
					placeholder="站點名稱"
					value={newName}
					onChange={(e) => onNewNameChange(e.target.value)}
					style={{
						flex: 1,
						padding: "4px 6px",
						fontSize: 12,
						border: "1px solid #d9d9d9",
						borderRadius: 4,
					}}
				/>
				<input
					type="url"
					placeholder="清單頁 URL (https://...)"
					value={newUrl}
					onChange={(e) => onNewUrlChange(e.target.value)}
					style={{
						flex: 2,
						padding: "4px 6px",
						fontSize: 12,
						border: "1px solid #d9d9d9",
						borderRadius: 4,
					}}
				/>
				<button
					type="button"
					onClick={() => onAdd()}
					disabled={addBusy}
					style={{ ...btn, background: "#1677ff", color: "white" }}
				>
					{addBusy ? "新增中…" : "新增"}
				</button>
			</div>
			{addError && (
				<div style={{ fontSize: 12, color: "#cf1322" }}>{addError}</div>
			)}
			{addWarning && (
				<div
					role="status"
					style={{
						marginTop: 6,
						padding: "8px 10px",
						background: "#fffbe6",
						border: "1px solid #ffe58f",
						borderRadius: 4,
						fontSize: 12,
						color: "#7c4d00",
					}}
				>
					<div style={{ marginBottom: 6 }}>
						⚠ 域名 <strong>{addWarning.hostname}</strong>{" "}
						未在渠道白名单，此站点爬取将被 SSRF
						守卫拒绝。建议先在上方「可爬取渠道」中添加 {addWarning.hostname}。
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<button
							type="button"
							onClick={() => onProceed()}
							disabled={addBusy}
							style={{ ...btn, background: "#faad14", color: "white" }}
						>
							仍然继续
						</button>
						<button
							type="button"
							onClick={() => onCancelWarning()}
							style={{ ...btn, background: "#f0f0f0" }}
						>
							取消
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
