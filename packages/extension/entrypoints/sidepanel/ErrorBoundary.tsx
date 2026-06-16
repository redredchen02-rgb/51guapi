import { Component } from "react";
import { logger } from "../../lib/logger";

interface Props {
	children: React.ReactNode;
	fallback?: React.ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		logger.error("ErrorBoundary", error.message, {
			stack: info.componentStack ?? undefined,
		});
	}

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback ?? (
					<div style={{ padding: 24, textAlign: "center" }}>
						<p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px" }}>
							发生了错误
						</p>
						<p
							className="text-muted"
							style={{ fontSize: "var(--font-sm)", margin: 0 }}
						>
							{this.state.error?.message}
						</p>
						<button
							type="button"
							className="btn btn-plain"
							style={{ marginTop: 12 }}
							onClick={() => this.setState({ hasError: false, error: null })}
						>
							重试
						</button>
					</div>
				)
			);
		}
		return this.props.children;
	}
}
