import { randomUUID } from "node:crypto";

// 同毫秒内 Date.now() 不变、Math.random 也可能撞，故再叠一个进程内单调计数器兜底唯一性
let counter = 0;

export function generateId(prefix: string): string {
	// crypto.randomUUID() 提供 122-bit 熵；取前两段 base16 + 单调计数器，杜绝同毫秒碰撞
	const suffix = `${randomUUID().replace(/-/g, "").slice(0, 12)}${(counter++).toString(36)}`;
	return `${prefix}_${Date.now()}_${suffix}`;
}
