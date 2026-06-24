import crypto from "node:crypto";

let activePin: string | null = null;

/**
 * 获取当前的 channel 写入 mutation PIN。
 * 1. 如果在 env 中有 GUAPI_MUTATION_PIN，直接使用之。
 * 2. 如果是 test 环境，使用固定 PIN。
 * 3. 否则，在运行期随机生成一个 6 位十六进制大写 PIN 并缓存在内存中。
 */
export function getMutationPin(): string {
	if (activePin !== null) {
		return activePin;
	}

	if (process.env.GUAPI_MUTATION_PIN) {
		activePin = process.env.GUAPI_MUTATION_PIN.trim();
		return activePin;
	}

	if (process.env.NODE_ENV === "test") {
		activePin = "test-pin-123456";
		return activePin;
	}

	activePin = crypto.randomBytes(3).toString("hex").toUpperCase();
	return activePin;
}

export function resetMutationPinForTest(): void {
	activePin = null;
}
