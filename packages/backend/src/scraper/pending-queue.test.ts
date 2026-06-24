import { expect, it } from "vitest";
import { WriteQueue } from "./pending-queue.js";

it("WriteQueue: enqueued fn() 同步拋錯 → Promise reject (line 36)", async () => {
	const q = new WriteQueue();
	await expect(
		q.enqueue(() => {
			throw new Error("sync error in queue");
		}),
	).rejects.toThrow("sync error in queue");
});
