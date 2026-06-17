// Shim for WXT's #imports virtual module in vitest.
// WxtVitest()'s UnimportPlugin does not always resolve the #imports virtual
// module when test files indirectly import lib files that use #imports.
// This shim re-exports the same symbols so vitest can resolve them.

export { browser } from "wxt/browser";
export { storage } from "wxt/utils/storage";
