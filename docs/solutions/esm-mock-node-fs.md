# ESM vi.mock('node:fs') 模式

## 背景

在 ESM（ECMAScript Modules）環境下，`node:fs` 的具名導出由一個**凍結的命名空間**提供，無法直接用 `vi.spyOn(fs, 'appendFileSync')` 攔截。解法是在模組頂層呼叫 `vi.mock()`，並透過 `importActual` 保留真實實作，再對需要 stub 的函數包一層 `vi.fn()`。

## 原始範例（來源：`packages/backend/src/services/audit-log.test.ts`，已於 refactor/tech-debt-cleanup 刪除）

```typescript
// node:fs named exports can't be spied on in ESM (the namespace is frozen), so
// mock the module up front. By default every fn delegates to the real impl;
// individual swallow-all tests override appendFileSync/mkdirSync per-call.
vi.mock("node:fs", async (importActual) => {
    const actual = await importActual<typeof import("node:fs")>();
    return {
        ...actual,
        mkdirSync: vi.fn(actual.mkdirSync),
        appendFileSync: vi.fn(actual.appendFileSync),
    };
});

// 必須在 vi.mock 之後 import（hoisting 確保 mock 先生效）
import { appendFileSync, mkdirSync } from "node:fs";
```

## 使用方式

```typescript
// 對個別測試 override
vi.mocked(appendFileSync).mockImplementationOnce(() => {
    throw new Error("disk full");
});
expect(() => someFunction()).not.toThrow();

// 每個測試後清理
afterEach(() => {
    vi.restoreAllMocks();
});
```

## 關鍵要點

1. `vi.mock()` 必須在文件最頂層（Vitest 會 hoist 它到所有 import 之前）
2. `importActual` 用 `async` 工廠函數，才能拿到真實模組
3. spread `...actual` 保留未 stub 的函數（`existsSync`、`readFileSync` 等繼續用真實版本）
4. 只對需要 spy 的函數包 `vi.fn()`，其餘不動
5. 最後 `import` 具名導出——hoisting 確保 mock 已先安裝
