type QueueItem<T = unknown> = {
	fn: () => T;
	resolve: (v: T) => void;
	reject: (e: Error) => void;
};

export class WriteQueue {
	private queue: QueueItem[] = [];
	private active = false;

	enqueue<T>(fn: () => T): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			// Safe: T is captured by the Promise<T> closure;
			// the cast is needed because TS contravariance prevents
			// QueueItem<T> → QueueItem<unknown> assignment.
			(this.queue as QueueItem<unknown>[]).push({
				fn,
				resolve,
				reject,
			} as QueueItem<unknown>);
			this.drain();
		});
	}

	private drain() {
		if (this.active) return;
		this.active = true;
		const next = this.queue.shift();
		if (!next) {
			this.active = false;
			return;
		}
		try {
			next.resolve(next.fn());
		} catch (e) {
			next.reject(e instanceof Error ? e : new Error(String(e)));
		}
		setImmediate(() => {
			this.active = false;
			this.drain();
		});
	}
}

export const pendingWriteQueue = new WriteQueue();
