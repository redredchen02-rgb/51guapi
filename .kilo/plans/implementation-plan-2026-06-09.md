# Implementation Plan

## Overview

This plan addresses four major tasks for the 51publisher monorepo:
1. JSON to SQLite data migration
2. SQLite concurrent write performance optimization  
3. E2E testing framework restoration
4. Production SSRF hostname allowlist configuration

---

## Task 1: JSON to SQLite Data Migration

### Current State Analysis
- `pending-store.ts` already migrated to SQLite (via `better-sqlite3`)
- `prompt-store.ts` and `batch-store.ts` still use JSON file storage
- No existing data migration scripts found
- Data directories: `packages/backend/data/prompts/`, `packages/backend/data/batches/`

### Implementation Plan

#### 1.1 Create Migration Script (`scripts/migrate-json-to-sqlite.ts`)
- Add new file in `packages/backend/scripts/`
- Create dedicated SQLite tables: `prompt_templates` and `batch_queue`
- Implement migration with transactions for atomic operations
- Include validation and rollback capabilities

#### 1.2 Schema Design

**prompt_templates table:**
```sql
CREATE TABLE IF NOT EXISTS prompt_templates (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  template       TEXT NOT NULL,
  few_shot_examples TEXT NOT NULL,
  model          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_updated ON prompt_templates(updated_at DESC);
```

**batch_queue table:**
```sql
CREATE TABLE IF NOT EXISTS batch_queue (
  id              TEXT PRIMARY KEY,
  tab_id          INTEGER NOT NULL,
  authorized_host TEXT NOT NULL,
  items           TEXT NOT NULL, -- JSON serialized
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batch_updated ON batch_queue(updated_at DESC);
```

#### 1.3 Migration Steps
1. Read all existing JSON files from `data/prompts/*.json` and `data/batches/*.json`
2. Validate JSON structure against TypeScript interfaces
3. Begin SQLite transaction
4. Insert records into new tables
5. Verify row counts match source
6. On success: rename old directories to `.bak` suffix
7. Provide `--dry-run` and `--rollback` CLI options

#### 1.4 Post-Migration Refactoring (Optional)
- Update `prompt-store.ts` to use SQLite
- Update `batch-store.ts` to use SQLite (per comment on line 74)
- Update routes to use new store implementations

---

## Task 2: SQLite Concurrent Write Performance Optimization

### Current State Analysis
- Using `better-sqlite3` with WAL mode already enabled (line 26 in `pending-db.ts`)
- Singleton pattern with single connection
- Synchronous API (blocking Node.js event loop)
- No explicit connection pooling or queueing

### Implementation Plan

#### 2.1 Benchmarking Approach
- Create benchmark script in `packages/backend/scripts/benchmark-sqlite.ts`
- Test concurrent writes with: 1, 10, 50, 100 concurrent operations
- Measure lock wait time, throughput, and error rate
- Run before and after optimization

#### 2.2 Optimizations

**Primary: WAL Mode (Already Implemented)**
- Already enabled in `pending-db.ts`
- Add additional WAL tuning pragmas:
  ```typescript
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('journal_size_limit = 67108864'); // 64MB
  ```

**Secondary: Write Queue Pattern (Recommended)**
- Create async write queue wrapper in `packages/backend/src/scraper/pending-queue.ts`
- Serialize writes to prevent SQLITE_BUSY errors
- Use `better-sqlite3`'s synchronous API but queue at application layer
- Pattern:
  ```typescript
  class WriteQueue {
    private queue: Array<() => void> = [];
    private processing = false;
    
    async enqueue<T>(operation: () => T): Promise<T> {
      return new Promise((resolve, reject) => {
        this.queue.push(() => {
          try { resolve(operation()); } 
          catch (e) { reject(e); }
        });
        this.flush();
      });
    }
  }
  ```

**Alternative Considered: Connection Pool**
- NOT recommended for `better-sqlite3` (single-writer design)
- Each connection would have separate WAL, causing conflicts

#### 2.3 Implementation Steps
1. Extend `pending-db.ts` with WAL tuning pragmas
2. Create `pending-queue.ts` wrapper for all write operations
3. Refactor `pending-store.ts` to use queued writes
4. Add benchmark script and run tests

---

## Task 3: E2E Testing Framework Restoration

### Current State Analysis
- E2E tests use jsdom + vitest (NOT Playwright)
- Configuration in `vitest.e2e.config.ts` exists and is minimal
- Tests in `tests/e2e/` directory
- Uses real Quill 2.0.2 for DOM testing

### Implementation Plan

#### 3.1 Verify Current Setup
The framework appears functional but needs verification in monorepo context.

#### 3.2 Configuration Updates

**Update `vitest.e2e.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/e2e/setup.ts'], // Add if needed for global test setup
    isolate: false, // Allow shared Quill state between tests
    testTimeout: 10000,
  },
});
```

#### 3.3 Potential Issues to Address
1. **Path resolution**: Ensure `../../lib/` imports work correctly
2. **Setup file**: Check if `tests/e2e/setup.ts` needed for global Quill config
3. **Quill loader**: Verify `helpers/quill-fixture.ts` works in monorepo structure

#### 3.4 Test Execution
- Run `pnpm --filter publisher-fill-assistant test:e2e`
- Verify all 6 E2E test files pass
- Add missing setup if tests fail

---

## Task 4: Production SSRF Hostname Allowlist

### Current State Analysis

**Backend (`scraper-routes.ts`):**
- Host validation compares caller URL hostname against registered site config
- Uses exact hostname match (no wildcards)
- No explicit allowlist - derived from configured sites

**Extension (`wxt.config.ts`):**
- `host_permissions: ['https://dx-999-adm.ympxbys.xyz/*']` - SINGLE host
- Production-configured but hardcoded

### Implementation Plan

#### 4.1 Define Production Allowlist Configuration

**Add to `.env.example` and document:**
```bash
# SSRF Protection - Production hostnames allowed for publication
# Format: comma-separated list of exact hostnames or wildcard patterns (*.example.com)
ALLOWED_HOSTS=https://dx-999-adm.ympxbys.xyz/*
```

**Create `packages/backend/src/config/ssrf-allowlist.ts`:**
```typescript
interface SSRFConfig {
  allowedHosts: string[];
  mode: 'fail-closed' | 'strict'; // Default: fail-closed
}

export function loadSSRfAllowlist(): SSRFConfig {
  const hosts = process.env.ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean) || [];
  return { allowedHosts: hosts, mode: 'fail-closed' };
}
```

#### 4.2 Update Backend Validation

**Modify `scraper-routes.ts` SSRF check (lines 35-50):**
- Add environment-based allowlist as overlay
- Validate both site config match AND allowlist presence
- Return 403 with clear error when blocked

#### 4.3 Update Extension Configuration

**Make `wxt.config.ts` configurable via environment:**
- Keep default for development
- Allow production override via `ALLOWED_HOSTS` env var
- Or create separate `wxt.config.production.ts`

#### 4.4 Security Layers

| Layer | Current | Enhancement |
|-------|---------|-------------|
| Backend SSRF | Site config match only | Add explicit allowlist validation |
| Extension | Hardcoded single host | Make configurable for deployment |
| Both | Exact match | Consider wildcard support (already in safety-gate) |

---

## Execution Order

1. **Task 4 first** - Security configuration is critical and blocks other work
2. **Task 1** - Migration is foundational for performance work  
3. **Task 2** - Optimize SQLite after migration complete
4. **Task 3** - Verify E2E after all changes

---

## Verification Commands

```bash
# After security config
pnpm --filter publisher-backend build

# After migration
node packages/backend/scripts/migrate-json-to-sqlite.js --dry-run

# After optimization
node packages/backend/scripts/benchmark-sqlite.js

# After all changes
pnpm test && pnpm --filter publisher-fill-assistant test:e2e
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Migration data loss | Backup directories, dry-run mode, rollback option |
| SQLite locking | WAL tuning + write queue (Task 2) |
| E2E test failures | Isolate with `isolate: false`, add setup file |
| Security misconfiguration | Default to fail-closed, document clearly |