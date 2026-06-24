import { beforeEach, describe, expect, it } from "vitest";
import { getMutationPin, resetMutationPinForTest } from "./mutation-pin.js";

describe("mutation-pin service", () => {
	beforeEach(() => {
		resetMutationPinForTest();
		delete process.env.GUAPI_MUTATION_PIN;
	});

	it("should return the configured PIN from environment variable if present", () => {
		process.env.GUAPI_MUTATION_PIN = "ENV_PIN_123";
		expect(getMutationPin()).toBe("ENV_PIN_123");
	});

	it("should cache the pin once read or generated", () => {
		process.env.GUAPI_MUTATION_PIN = "ENV_PIN_123";
		const pin1 = getMutationPin();
		process.env.GUAPI_MUTATION_PIN = "ENV_PIN_456";
		const pin2 = getMutationPin();
		expect(pin2).toBe(pin1);
		expect(pin2).toBe("ENV_PIN_123");
	});

	it("should fallback to a default test PIN when NODE_ENV is test", () => {
		const pin = getMutationPin();
		expect(pin).toBe("test-pin-123456");
	});

	it("should generate a random 6-character PIN when not in test env and no env variable set", () => {
		const originalEnv = process.env.NODE_ENV;
		try {
			// Temporarily change NODE_ENV
			process.env.NODE_ENV = "production";
			const pin = getMutationPin();
			expect(pin).toMatch(/^[0-9A-F]{6}$/);

			// Second call should return the same cached PIN
			const pin2 = getMutationPin();
			expect(pin2).toBe(pin);
		} finally {
			process.env.NODE_ENV = originalEnv;
		}
	});
});
