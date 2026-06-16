import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect all file-based stores (batch/prompt JSON, pending.db, config) to an
// isolated temp dir so tests never touch the real packages/backend/data.
// Runs before any test module is imported, so module-level DATA_DIR constants
// pick up the override.
process.env.PUBLISHER_DATA_DIR = mkdtempSync(join(tmpdir(), "publisher-test-"));
