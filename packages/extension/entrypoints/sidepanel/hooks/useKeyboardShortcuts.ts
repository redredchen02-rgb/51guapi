import { useEffect, useRef } from "react";

interface KeyboardShortcutsOptions {
	onGenerate?: () => void;
	onFill?: () => void;
	onNext?: () => void;
	onSave?: () => void;
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions) {
	// 调用方每次渲染都传入新的 options 字面量。若把 options 放进 effect 依赖,
	// 监听器会每渲染一次就拆装一次,在拆装窗口里偶发丢失 keydown(CI 慢机更明显)。
	// 故用 ref 持有最新回调,监听器只注册一次。
	const optionsRef = useRef(options);
	optionsRef.current = options;

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const modifier = event.ctrlKey || event.metaKey;
			const handlers = optionsRef.current;

			// Ctrl/Cmd + Enter: 生成草稿
			if (modifier && event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				handlers.onGenerate?.();
				return;
			}

			// Ctrl/Cmd + Shift + Enter: 填充到当前页
			if (modifier && event.shiftKey && event.key === "Enter") {
				event.preventDefault();
				handlers.onFill?.();
				return;
			}

			// Ctrl/Cmd + ArrowRight: 下一条
			if (modifier && event.key === "ArrowRight") {
				event.preventDefault();
				handlers.onNext?.();
				return;
			}

			// Ctrl/Cmd + S: 保存
			if (modifier && event.key === "s") {
				event.preventDefault();
				handlers.onSave?.();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);
}
