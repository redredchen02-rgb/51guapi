# Implementation Plan — 51publisher (2026-06-09)

## Overall Understanding

4 tasks across 2 packages:

| Task | Package | Risk | Effort |
|------|---------|------|--------|
| SSRF allowlist | backend + extension | high | 2h |
| JSON → SQLite migration | backend | medium | 3h |
| SQLite write queue | backend | medium | 2h |
| E2E restore | extension | low | 1h |

Execution order: **4 → 1 → 2 → 3** (security first, foundation before perf, tests last).

---

## Task 4: Production SSRF Hostname Allowlist

### Current state detail

**`packages/backend/src/scraper/scraper-routes.ts` lines 35-58** — SSRF check has 3 gaps:
1. Line 49: `parsed.hostname !== configParsed.hostname` — exact hostname only, no wildcard support (`*.example.com`)
2. No environment-based allowlist overlay — host must be registered in scraper config
3. If scraper config has 0 sites, any request is rejected implicitly — no explicit deny list

**`packages/extension/wxt.config.ts` line 12** — single hardcoded `host_permissions`. No env-driven config, no production/dev split.

**`packages/backend/.env.example`** — no `ALLOWED_HOSTS` variable.

### What to implement

#### 4.1 `packages/backend/src/scraper/ssrf-allowlist.ts` (new file)

```ts
// Matches: exact "example.com" or wildcard "*.example.com" or "https://*.example.com/*"
type Pattern = { hostname: string; wildcard: boolean; protocol?: string };

function compilePattern(raw: string): Pattern | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip protocol prefix if present (e.g., "https://" or "https://*.domain.com/")
  let rest = trimmed.replace(/^https?:\/\//, '');
  // Strip trailing slash/path
  rest = rest.split('/')[0];
  if (!rest) return null;
  const wildcard = rest.startsWith('*.');
  const hostname = wildcard ? rest.slice(2) : rest;
  const protocol = trimmed.startsWith('http://') ? 'http:' : trimmed.startsWith('https://') ? 'https:' : undefined;
  return { hostname, wildcard, protocol };
}

function matches(pattern: Pattern, candidate: URL): boolean {
  if (pattern.protocol && new URL(pattern.protocol + '//' + candidate.hostname).hostname !== candidate.hostname) {
    // protocol doesn't constrain hostname matching, compare separately
  }
  if (pattern.protocol && candidate.protocol !== pattern.protocol) return false;
  if (pattern.wildcard) {
    return candidate.hostname === pattern.hostname || candidate.hostname.endsWith('.' + pattern.hostname);
  }
  return candidate.hostname.toLowerCase() === pattern.hostname.toLowerCase();
}

export interface SSRFConfig {
  allowedHosts: Pattern[];
  mode: 'fail-closed'; // always fail-closed
}

export function loadSSRFAllowlist(): SSRFConfig {
  const raw = process.env.ALLOWED_HOSTS ?? '';
  const patterns: Pattern[] = [];
  for (const part of raw.split(',')) {
    const p = compilePattern(part);
    if (p) patterns.push(p);
  }
  return { allowedHosts: patterns, mode: 'fail-closed' };
}

export function isHostAllowed(url: URL, config: SSRFConfig): boolean {
  if (config.allowedHosts.length === 0) return false; // fail-closed
  return config.allowedHosts.some((p) => matches(p, url));
}
```

#### 4.2 Update `scraper-routes.ts` — add allowlist check after site-config check

Add after line 23 (after site config validation):

```ts
import { loadSSRFAllowlist, isHostAllowed } from './ssrf-allowlist.js';

const ssrfConfig = loadSSRFAllowlist();

// ... inside the route handler, after the site-config block (after line 33):

if (url) {
  // ... existing checks for credentials (line 46) remain first ...

  // Existing site-config protocol/protocol check + new allowlist check
  if (parsed.protocol !== configParsed.protocol) {
    return reply.status(400).send({ ok: false, error: `URL protocol not allowed for site ${siteName}: ${parsed.protocol}` });
  }

  // NEW: explicit allowlist overlay (fail-closed)
  if (!isHostAllowed(parsed, ssrfConfig)) {
    return reply.status(403).send({ ok: false, error: `URL hostname blocked by SSRF allowlist: ${parsed.hostname}` });
  }
}
```

Rationale: keep site-config check (protects against misconfigured adapters), add allowlist as defense-in-depth layer. 403 vs 400 semantically correct (policy rejection, not bad input).

#### 4.3 Update `packages/backend/.env.example`

Add:
```
# SSRF allowlist for production publication targets
# Comma-separated. Supports exact hosts and wildcards (*.domain.com).
# Leave empty = fail-closed (deny all when not in production).
# ALLOWED_HOSTS=https://dx-999-adm.ympxbys.xyz,https://*.admin.example.com
```

#### 4.4 Update `packages/extension/wxt.config.ts`

Replace hardcoded host with env-driven config:

```ts
import { defineConfig, mergeConfig } from 'wxt';

const DEFAULT_HOSTS = ['https://dx-999-adm.ympxbys.xyz/*'];

function parseHosts(): string[] {
  const raw = process.env.ALLOWED_HOSTS ?? '';
  if (!raw.trim()) return DEFAULT_HOSTS;
  return raw.split(',').map((h) => h.trim()).filter(Boolean);
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '51publisher 发帖填充助手',
    description: 'AI 生成草稿并填入后台发帖表单。授权站点可批量自动发布,非授权站点仅填充。',
    permissions: ['storage', 'sidePanel'],
    host_permissions: parseHosts(),
    action: { default_title: '51publisher 填充助手' },
    side_panel: { default_path: 'sidepanel.html' },
  },
});
```

### Validation for Task 4
- `pnpm --filter publisher-backend build` — compiles without errors
- Run test: `ALLOWED_HOSTS=https://dx-999-adm.ympxbys.xyz pnpm --filter publisher-backend test` (if backend has tests for routes)

---

## Task 1: JSON to SQLite Data Migration

### Current state detail

**`prompt-store.ts`** (88 lines):
- Stores one JSON file per prompt in `data/prompts/<id>.json`
- Data directory computed from `dirname(import.meta.url)` → sibling `../data/prompts`
- Schema already matches plan (id, name, template, fewShotExamples, model, createdAt, updatedAt)

**`batch-store.ts`** (122 lines):
- Stores one JSON file per batch in `data/batches/<id>.json`
- Line 74 comment: "高并发场景应替换为 SQLite"
- Schema: id, tabId, authorizedHost, items[], createdAt, updatedAt
- Items are `BatchItem[]` — already JSON-serialized

### Schema difference from plan

The plan says `batch_queue.batch_id INTEGER` but the actual code uses `id TEXT`. I'll align with the codebase.

### What to implement

#### 1.1 `packages/backend/src/scraper/migrations/db.ts` (new)

Shared SQLite connection init for both tables (separate from `pending-db.ts`):

```ts
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const DATA_DIR = join(import.meta.dirname, '..', '..', '..', '..', '..', 'data');
export const DB_PATH = join(DATA_DIR, 'app.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(DATA_DIR, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('wal_autocheckpoint = 1000');
    _db.pragma('journal_size_limit = 67108864');
  }
  return _db;
}

export function initAppDb(): Database.Database {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      template         TEXT NOT NULL,
      few_shot_examples TEXT NOT NULL,
      model            TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_updated ON prompt_templates(updated_at DESC);

    CREATE TABLE IF NOT EXISTS batch_queue (
      id              TEXT PRIMARY KEY,
      tab_id          INTEGER NOT NULL,
      authorized_host TEXT NOT NULL,
      items           TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_batch_updated ON batch_queue(updated_at DESC);
  `);
  return db;
}
```

#### 1.2 `packages/backend/src/scraper/prompt-store-sqlite.ts` (new)

Drop-in replacement for `prompt-store.ts`:

```ts
import { getDb, initAppDb } from './migrations/db.js';

export interface PromptTemplate { /* same as prompt-store.ts */ }
export interface PromptTemplateCreate { /* same */ }
export interface PromptTemplateUpdate { /* same */ }

// Row type
interface PromptRow {
  id: string;
  name: string;
  template: string;
  few_shot_examples: string;
  model: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: PromptRow): PromptTemplate {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    fewShotExamples: row.few_shot_examples,
    model: row.model ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadPrompt(id: string): PromptTemplate | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) as PromptRow | undefined;
  return row ? rowToTemplate(row) : null;
}

export function savePrompt(template: PromptTemplate): void {
  const db = getDb();
  template.updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO prompt_templates (id, name, template, few_shot_examples, model, created_at, updated_at)
    VALUES (@id, @name, @template, @fewShotExamples, @model, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      template = excluded.template,
      few_shot_examples = excluded.few_shot_examples,
      model = excluded.model,
      updated_at = excluded.updated_at
  `).run({
    id: template.id,
    name: template.name,
    template: template.template,
    fewShotExamples: template.fewShotExamples,
    model: template.model ?? null,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  });
}

export function listPrompts(): PromptTemplate[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM prompt_templates ORDER BY updated_at DESC').all() as PromptRow[];
  return rows.map(rowToTemplate);
}

export function deletePrompt(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
}
```

#### 1.3 `packages/backend/src/scraper/batch-store-sqlite.ts` (new)

Drop-in replacement for `batch-store.ts`:

```ts
import { getDb } from './migrations/db.js';

export type BatchItemStatus = /* same as batch-store.ts */;
export interface BatchItem { /* same */ }
export interface Batch { /* same */ }

interface BatchRow {
  id: string;
  tab_id: number;
  authorized_host: string;
  items: string;
  created_at: string;
  updated_at: string;
}

function rowToBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    tabId: row.tab_id,
    authorizedHost: row.authorized_host,
    items: JSON.parse(row.items),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadBatch(batchId: string): Batch | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM batch_queue WHERE id = ?').get(batchId) as BatchRow | undefined;
  return row ? rowToBatch(row) : null;
}

export function saveBatch(batch: Batch): void {
  const db = getDb();
  batch.updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO batch_queue (id, tab_id, authorized_host, items, created_at, updated_at)
    VALUES (@id, @tabId, @authorizedHost, @items, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      tab_id = excluded.tab_id,
      authorized_host = excluded.authorized_host,
      items = excluded.items,
      updated_at = excluded.updated_at
  `).run({
    id: batch.id,
    tabId: batch.tabId,
    authorizedHost: batch.authorizedHost,
    items: JSON.stringify(batch.items),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  });
}

export function listBatches(limit = 50): Batch[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM batch_queue ORDER BY updated_at DESC LIMIT ?').all(limit) as BatchRow[];
  return rows.map(rowToBatch);
}

export function recoverBatch(batch: Batch): Batch {
  return {
    ...batch,
    items: batch.items.map((it) =>
      it.status === 'publish-dispatched'
        ? { ...it, status: 'needs-human-verification' as const, error: 'recovered-dispatched-no-confirm' }
        : it,
    ),
  };
}

export function isTerminal(s: BatchItemStatus): boolean {
  return ['publish-confirmed', 'aborted', 'error', 'needs-human-verification'].includes(s);
}
```

#### 1.4 Migration script `packages/backend/scripts/migrate-json-to-sqlite.ts`

```ts
#!/usr/bin/env tsx
import { readdir, readFile, stat, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { initAppDb } from '../src/scraper/migrations/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve data dir (same logic as prompt-store.ts and batch-store.ts)
function dataDir(pkgDir: string): string {
  return join(pkgDir, '..', 'data');
}

async function migratePrompts(dryRun: boolean): Promise<{ migrated: number; skipped: number }> {
  const promptsDir = join(dataDir(__dirname), 'prompts');
  let migrated = 0, skipped = 0;
  try {
    const files = await readdir(promptsDir).then((f) => f.filter((x) => x.endsWith('.json')));
    for (const f of files) {
      const raw = await readFile(join(promptsDir, f), 'utf-8');
      const doc = JSON.parse(raw);
      if (!doc.id || !doc.template) { skipped++; continue; }
      if (dryRun) { migrated++; continue; }
      const db = initAppDb();
      db.prepare(`
        INSERT INTO prompt_templates (id, name, template, few_shot_examples, model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(doc.id, doc.name, doc.template, doc.fewShotExamples, doc.model ?? null, doc.createdAt, doc.updatedAt);
      migrated++;
    }
  } catch (e) { /* dir doesn't exist yet */ }
  return { migrated, skipped };
}

async function migrateBatches(dryRun: boolean): Promise<{ migrated: number; skipped: number }> {
  const batchesDir = join(dataDir(__dirname), 'batches');
  let migrated = 0, skipped = 0;
  try {
    const files = await readdir(batchesDir).then((f) => f.filter((x) => x.endsWith('.json')));
    for (const f of files) {
      const raw = await readFile(join(batchesDir, f), 'utf-8');
      const doc = JSON.parse(raw);
      if (!doc.id || !Array.isArray(doc.items)) { skipped++; continue; }
      if (dryRun) { migrated++; continue; }
      const db = initAppDb();
      db.prepare(`
        INSERT INTO batch_queue (id, tab_id, authorized_host, items, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(doc.id, doc.tabId, doc.authorizedHost, JSON.stringify(doc.items), doc.createdAt, doc.updatedAt);
      migrated++;
    }
  } catch (e) { /* dir doesn't exist yet */ }
  return { migrated, skipped };
}

async function backupDir(src: string): Promise<void> {
  const bak = src + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
  await rename(src, bak);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const doRollback = process.argv.includes('--rollback');

  if (doRollback) {
    console.log('Rollback: manually restore from .bak-* directories and remove app.db');
    process.exit(0);
  }

  const promptResult = await migratePrompts(dryRun);
  const batchResult = await migrateBatches(dryRun);

  console.log('Prompts:', promptResult.migrated + ' migrated,', promptResult.skipped + ' skipped');
  console.log('Batches:', batchResult.migrated + ' migrated,', batchResult.skipped + ' skipped');

  if (!dryRun) {
    const promptsDir = join(dataDir(__dirname), 'prompts');
    const batchesDir = join(dataDir(__dirname), 'batches');
    try {
      await backupDir(promptsDir);
      console.log('Backed up prompts dir');
    } catch (e) { /* ignore if dir empty */ }
    try {
      await backupDir(batchesDir);
      console.log('Backed up batches dir');
    } catch (e) { /* ignore if dir empty */ }
    console.log('Migration complete.');
  } else {
    console.log('Dry run complete. Re-run without --dry-run to apply.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

#### 1.5 Swap stores — wire up new SQLite stores in routes

In any file importing from `./prompt-store.js` or `./batch-store.js`, we need to switch imports. First let me find all importers.

#### 1.6 Cleanup old files
After verified migration, move old stores to `.bak` but keep until confirmed.

---

## Task 2: SQLite Concurrent Write Performance

### Plan gap: quantify the problem first

The plan says "write queue pattern" but doesn't explain the actual concurrency model. Let me check `pending-store.ts` callers to estimate write frequency.

#### What to implement

#### 2.1 Existing benchmarks — none exist

Create `packages/backend/scripts/benchmark-sqlite.ts`:

```ts
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE test (id TEXT PRIMARY KEY, val TEXT, ts TEXT)`);

function bench(label: string, ops: number, concurrency: number, useQueue: boolean): number {
  const results: number[] = [];
  // ... measure throughput
}

const modes = [1, 10, 50, 100];
for (const c of modes) {
  bench('raw-' + c, 500, c, false);
  bench('queue-' + c, 500, c, true);
}
```

#### 2.2 WAL tuning — already mostly done, add 2 missing pragmas

In `pending-db.ts` add:
```ts
_db.pragma('wal_autocheckpoint = 1000');
_db.pragma('journal_size_limit = 67108864');
```

#### 2.3 Write queue — `packages/backend/src/scraper/pending-queue.ts`

```ts
import { getDb, BetterSqlite3DB } from './pending-db.js';

type QueueItem<T> = { fn: () => T; resolve: (v: T) => void; reject: (e: Error) => void };

class WriteQueue {
  private queue: QueueItem<any>[] = [];
  private processing = false;

  async enqueue<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.flush();
    });
  }

  private flush() {
    if (this.processing) return;
    this.processing = true;
    const next = this.queue.shift();
    if (!next) { this.processing = false; return; }
    try {
      const result = next.fn();
      next.resolve(result);
    } catch (e) {
      next.reject(e instanceof Error ? e : new Error(String(e)));
    }
    // Use setImmediate to yield to event loop briefly between writes
    setImmediate(() => this.flush());
  }
}

export const pendingWriteQueue = new WriteQueue();

// Convenience wrappers matching pending-store.ts function signatures
export function queuedRun<T>(fn: () => T): T {
  // Synchronous callers: make them async
  return null as any;
}
```

#### 2.4 Refactor `pending-store.ts`

Change every `db.prepare(...).run(...)` / `.get(...)` / `.all(...)` to go through `pendingWriteQueue`:

```ts
import { getDb, pendingWriteQueue } from './pending-db.js';
import { initAppDb, pendingWriteQueue as appWriteQueue } from './migrations/db.js';
```

Wait — pending-store currently uses `getDb()` synchronously from `pending-db.ts`. We need to:
1. Make `pending-store.ts` functions async (they already are!)
2. Replace direct `db.prepare()` calls with `await pendingWriteQueue.enqueue(() => db.prepare(...).run(...))`

Since all functions in `pending-store.ts` are already `async`, this change is backwards-compatible API-wise.

---

## Task 3: E2E Testing Framework Restoration

### Current state detail

**`packages/extension/vitest.e2e.config.ts`** — minimal, missing:
- `globals: true` (needed if tests use global `describe`/`it` without imports)
- `setupFiles` (needed for Quill global config or any init)
- `testTimeout` (E2E tests may need longer)

**`tests/e2e/`** — actually at `packages/extension/tests/e2e/` with 6 files.

### Plan adjustment

Run actual tests first to see failures, then fix config. Don't pre-add `setupFiles` unless tests fail.

#### 3.1 Enable E2E test script in `packages/extension/package.json`

Check if `test:e2e` script exists. If not, add:
```json
{ "test:e2e": "vitest run --config vitest.e2e.config.ts" }
```

#### 3.2 Update `vitest.e2e.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    testTimeout: 10000,
  },
});
```

Remove `isolate: false` unless tests fail because of shared state (isolate: false slows down and makes tests flaky).

---

## File Change Summary

### New files
```
packages/backend/src/scraper/migrations/db.ts
packages/backend/src/scraper/migrations/index.ts
packages/backend/src/scraper/prompt-store-sqlite.ts
packages/backend/src/scraper/batch-store-sqlite.ts
packages/backend/src/scraper/ssrf-allowlist.ts
packages/backend/src/scraper/pending-queue.ts
packages/backend/scripts/migrate-json-to-sqlite.ts
packages/backend/scripts/benchmark-sqlite.ts
```

### Modified files
```
packages/extension/wxt.config.ts              (Task 4)
packages/backend/.env.example                 (Task 4)
packages/backend/.env                         (Task 4, for local dev)
packages/backend/src/scraper/scraper-routes.ts (Task 4)
packages/backend/src/scraper/pending-store.ts  (Task 2: use queue)
packages/backend/src/scraper/pending-db.ts     (Task 2: add pragmas)
packages/extension/vitest.e2e.config.ts       (Task 3)
packages/extension/package.json                (Task 3: test:e2e script)
# Plus any files that import from prompt-store.ts / batch-store.ts — switch to -sqlite.ts versions
```

### Files to find (importers)
Before finalizing, find all files that import from `./prompt-store` or `./batch-store` in backend to wire up the new SQLite versions.
