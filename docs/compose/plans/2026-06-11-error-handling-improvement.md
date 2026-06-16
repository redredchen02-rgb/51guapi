# 错误处理改进实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供更清晰的错误信息和解决方案，添加错误重试机制

**Architecture:** 使用 React Hook 管理错误状态，添加错误重试逻辑，支持错误日志记录

**Tech Stack:** React, TypeScript, CSS

---

### Task 1: 创建错误处理 Hook

**Covers:** [S3]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useErrorHandler.ts`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useErrorHandler.test.ts
import { renderHook, act } from '@testing-library/react';
import { useErrorHandler } from './useErrorHandler';

describe('useErrorHandler', () => {
  it('initializes with no error', () => {
    const { result } = renderHook(() => useErrorHandler());
    expect(result.current.error).toBeNull();
    expect(result.current.isRetrying).toBe(false);
  });

  it('captures error', () => {
    const { result } = renderHook(() => useErrorHandler());
    
    act(() => {
      result.current.handleError(new Error('测试错误'));
    });
    
    expect(result.current.error).toBe('测试错误');
  });

  it('clears error', () => {
    const { result } = renderHook(() => useErrorHandler());
    
    act(() => {
      result.current.handleError(new Error('测试错误'));
    });
    
    act(() => {
      result.current.clearError();
    });
    
    expect(result.current.error).toBeNull();
  });

  it('retries operation', async () => {
    const { result } = renderHook(() => useErrorHandler());
    const mockOperation = jest.fn()
      .mockRejectedValueOnce(new Error('第一次失败'))
      .mockResolvedValueOnce('成功');
    
    await act(async () => {
      await result.current.retry(mockOperation);
    });
    
    expect(mockOperation).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('handles retry failure', async () => {
    const { result } = renderHook(() => useErrorHandler());
    const mockOperation = jest.fn()
      .mockRejectedValue(new Error('持续失败'));
    
    await act(async () => {
      await result.current.retry(mockOperation);
    });
    
    expect(mockOperation).toHaveBeenCalledTimes(3); // 默认重试 3 次
    expect(result.current.error).toBe('持续失败');
  });

  it('respects max retries', async () => {
    const { result } = renderHook(() => useErrorHandler());
    const mockOperation = jest.fn()
      .mockRejectedValue(new Error('失败'));
    
    await act(async () => {
      await result.current.retry(mockOperation, 2);
    });
    
    expect(mockOperation).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run hooks/useErrorHandler.test.ts`
Expected: FAIL with "Cannot find module './useErrorHandler'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useErrorHandler.ts
import { useState, useCallback } from 'react';

interface UseErrorHandlerReturn {
  error: string | null;
  isRetrying: boolean;
  handleError: (error: Error | string) => void;
  clearError: () => void;
  retry: <T>(operation: () => Promise<T>, maxRetries?: number) => Promise<T | null>;
}

export function useErrorHandler(): UseErrorHandlerReturn {
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleError = useCallback((error: Error | string) => {
    const message = error instanceof Error ? error.message : String(error);
    setError(message);
    console.error('[ErrorHandler]', message);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const retry = useCallback(async <T>(
    operation: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T | null> => {
    setIsRetrying(true);
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        clearError();
        setIsRetrying(false);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[ErrorHandler] Attempt ${attempt}/${maxRetries} failed:`, lastError.message);
        
        if (attempt < maxRetries) {
          // 指数退避
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    
    if (lastError) {
      handleError(lastError);
    }
    setIsRetrying(false);
    return null;
  }, [clearError, handleError]);

  return {
    error,
    isRetrying,
    handleError,
    clearError,
    retry,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run hooks/useErrorHandler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/hooks/useErrorHandler.ts packages/extension/entrypoints/sidepanel/hooks/useErrorHandler.test.ts
git commit -m "feat: add useErrorHandler hook"
```

### Task 2: 创建错误提示组件

**Covers:** [S3]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/components/ErrorDisplay.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/components/ErrorDisplay.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorDisplay } from './ErrorDisplay';

describe('ErrorDisplay', () => {
  it('renders error message', () => {
    render(<ErrorDisplay message="测试错误" />);
    expect(screen.getByText('测试错误')).toBeInTheDocument();
  });

  it('renders with retry button', () => {
    const onRetry = jest.fn();
    render(<ErrorDisplay message="测试错误" onRetry={onRetry} />);
    
    expect(screen.getByText('重试')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders with dismiss button', () => {
    const onDismiss = jest.fn();
    render(<ErrorDisplay message="测试错误" onDismiss={onDismiss} />);
    
    expect(screen.getByText('关闭')).toBeInTheDocument();
    fireEvent.click(screen.getByText('关闭'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows solution hint', () => {
    render(<ErrorDisplay message="网络错误" solution="请检查网络连接" />);
    expect(screen.getByText('请检查网络连接')).toBeInTheDocument();
  });

  it('shows error details', () => {
    render(<ErrorDisplay message="错误" details="详细信息" />);
    expect(screen.getByText('详细信息')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run components/ErrorDisplay.test.tsx`
Expected: FAIL with "Cannot find module './ErrorDisplay'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/components/ErrorDisplay.tsx
import React, { useState } from 'react';

interface ErrorDisplayProps {
  message: string;
  solution?: string;
  details?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorDisplay({ message, solution, details, onRetry, onDismiss }: ErrorDisplayProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      role="alert"
      style={{
        background: '#fff1f0',
        border: '1px solid #ffa39e',
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 600, color: '#cf1322', marginBottom: 4 }}>
            {message}
          </div>
          {solution && (
            <div style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 4 }}>
              {solution}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                border: 'none',
                background: '#ff7875',
                color: 'white',
                padding: '4px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              重试
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="关闭"
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: '#8c8c8c',
              }}
            >
              关闭
            </button>
          )}
        </div>
      </div>
      
      {details && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: '#1677ff',
              padding: 0,
            }}
          >
            {showDetails ? '隐藏详情' : '显示详情'}
          </button>
          {showDetails && (
            <pre
              style={{
                background: '#fff7e6',
                border: '1px solid #ffd591',
                borderRadius: 4,
                padding: 8,
                marginTop: 4,
                fontSize: 11,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {details}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run components/ErrorDisplay.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/components/ErrorDisplay.tsx packages/extension/entrypoints/sidepanel/components/ErrorDisplay.test.tsx
git commit -m "feat: add ErrorDisplay component"
```

### Task 3: 集成错误处理到主界面

**Covers:** [S3]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/App.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import { useErrorHandler } from './hooks/useErrorHandler';

jest.mock('./hooks/useErrorHandler');
jest.mock('./hooks/useKeyboardShortcuts');
jest.mock('./hooks/useAutoSave');
jest.mock('../../lib/messaging', () => ({
  requestGenerate: jest.fn().mockRejectedValue(new Error('网络错误')),
  requestFill: jest.fn(),
  buildPrompt: jest.fn(),
}));
jest.mock('../../lib/storage', () => ({
  getSettings: jest.fn().mockResolvedValue({ promptTemplate: '' }),
  getCurrentDraft: jest.fn().mockResolvedValue(null),
  saveCurrentDraft: jest.fn(),
  clearCurrentDraft: jest.fn(),
}));
jest.mock('../../lib/auth-client', () => ({
  isAuthenticated: jest.fn().mockResolvedValue(true),
}));

describe('App with error handling', () => {
  beforeEach(() => {
    const mockErrorHandler = useErrorHandler as jest.Mock;
    mockErrorHandler.mockReturnValue({
      error: null,
      isRetrying: false,
      handleError: jest.fn(),
      clearError: jest.fn(),
      retry: jest.fn().mockResolvedValue(null),
    });
  });

  it('shows error display when error occurs', async () => {
    const mockErrorHandler = useErrorHandler as jest.Mock;
    const mockHandleError = jest.fn();
    mockErrorHandler.mockReturnValue({
      error: '网络错误',
      isRetrying: false,
      handleError: mockHandleError,
      clearError: jest.fn(),
      retry: jest.fn().mockResolvedValue(null),
    });
    
    render(<App />);
    
    // 模拟用户操作
    fireEvent.change(screen.getByPlaceholderText('输入选题/主题...'), {
      target: { value: '测试选题' },
    });
    
    // 点击生成草稿
    fireEvent.click(screen.getByText('生成草稿'));
    
    // 等待错误显示
    await waitFor(() => {
      expect(screen.getByText('网络错误')).toBeInTheDocument();
    });
  });

  it('retries operation when retry button clicked', async () => {
    const mockErrorHandler = useErrorHandler as jest.Mock;
    const mockRetry = jest.fn().mockResolvedValue({ ok: true, draft: { title: '测试' } });
    mockErrorHandler.mockReturnValue({
      error: '网络错误',
      isRetrying: false,
      handleError: jest.fn(),
      clearError: jest.fn(),
      retry: mockRetry,
    });
    
    render(<App />);
    
    // 显示错误
    fireEvent.change(screen.getByPlaceholderText('输入选题/主题...'), {
      target: { value: '测试选题' },
    });
    fireEvent.click(screen.getByText('生成草稿'));
    
    await waitFor(() => {
      expect(screen.getByText('网络错误')).toBeInTheDocument();
    });
    
    // 点击重试
    fireEvent.click(screen.getByText('重试'));
    
    expect(mockRetry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: FAIL with "useErrorHandler is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/App.tsx
// 在文件顶部添加导入
import { ErrorDisplay } from './components/ErrorDisplay';
import { useErrorHandler } from './hooks/useErrorHandler';

// 在 App 组件内部添加 hook 调用
export function App() {
  // ... 现有状态
  const { error, isRetrying, handleError, clearError, retry } = useErrorHandler();

  // 修改 handleGenerate 函数
  async function handleGenerate() {
    if (!topic.trim()) {
      handleError('请先输入主题。');
      return;
    }
    clearError();
    setResults([]);
    setMode('generating');
    
    const result = await retry(async () => {
      const token = ++genTokenRef.current;
      const res = await requestGenerate(
        buildPrompt(promptTemplateRef.current, topic),
      );
      
      if (token !== genTokenRef.current) return null;
      
      if (res.ok) {
        updateDraft(res.draft);
        setMode('draft');
        return res;
      } else {
        throw new Error(
          res.kind === 'no-key' ? `${res.error}(点右上角设置)` : res.error,
        );
      }
    });
    
    if (!result) {
      setMode(draft ? 'draft' : 'empty');
    }
  }

  // 修改 handleFill 函数
  async function handleFill() {
    if (!draft) return;
    clearError();
    setMode('filling');
    
    const result = await retry(async () => {
      const res = await requestFill(draft);
      if (!res.ok) {
        throw new Error(res.error);
      }
      return res;
    });
    
    if (result) {
      setResults(result.results);
      const anyProblem = result.results.some((r) => r.status !== 'filled');
      setMode(anyProblem ? 'partial' : 'filled');
    } else {
      setMode('draft');
    }
  }

  // 在 JSX 中添加错误显示
  return (
    <Wrap>
      {/* ... 现有 JSX */}
      
      {error && (
        <ErrorDisplay
          message={error}
          onRetry={() => {
            if (mode === 'generating') {
              handleGenerate();
            } else if (mode === 'filling') {
              handleFill();
            }
          }}
          onDismiss={clearError}
          isRetrying={isRetrying}
        />
      )}
      
      {/* ... 其余 JSX */}
    </Wrap>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/App.tsx
git commit -m "feat: integrate error handling into App"
```

### Task 4: 添加错误日志记录

**Covers:** [S3]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useErrorLogger.ts`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useErrorLogger.test.ts
import { renderHook, act } from '@testing-library/react';
import { useErrorLogger } from './useErrorLogger';

jest.mock('../../lib/storage', () => ({
  getErrorLogs: jest.fn().mockResolvedValue([]),
  saveErrorLog: jest.fn().mockResolvedValue(undefined),
}));

describe('useErrorLogger', () => {
  it('initializes with empty logs', async () => {
    const { result } = renderHook(() => useErrorLogger());
    
    expect(result.current.logs).toEqual([]);
  });

  it('logs error', async () => {
    const { result } = renderHook(() => useErrorLogger());
    
    await act(async () => {
      await result.current.logError(new Error('测试错误'), { context: '测试' });
    });
    
    expect(result.current.logs).toHaveLength(1);
    expect(result.current.logs[0].message).toBe('测试错误');
  });

  it('retrieves error logs', async () => {
    const storage = require('../../lib/storage');
    storage.getErrorLogs.mockResolvedValue([
      { id: '1', message: '历史错误', timestamp: new Date().toISOString() },
    ]);
    
    const { result } = renderHook(() => useErrorLogger());
    
    await act(async () => {
      await result.current.retrieveLogs();
    });
    
    expect(result.current.logs).toHaveLength(1);
  });

  it('clears error logs', async () => {
    const storage = require('../../lib/storage');
    storage.getErrorLogs.mockResolvedValue([
      { id: '1', message: '历史错误', timestamp: new Date().toISOString() },
    ]);
    
    const { result } = renderHook(() => useErrorLogger());
    
    await act(async () => {
      await result.current.retrieveLogs();
    });
    
    await act(async () => {
      await result.current.clearLogs();
    });
    
    expect(result.current.logs).toEqual([]);
  });

  it('exports error logs', async () => {
    const { result } = renderHook(() => useErrorLogger());
    
    await act(async () => {
      await result.current.logError(new Error('测试错误'));
    });
    
    const exported = result.current.exportLogs();
    expect(exported).toContain('测试错误');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run hooks/useErrorLogger.test.ts`
Expected: FAIL with "Cannot find module './useErrorLogger'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useErrorLogger.ts
import { useState, useCallback } from 'react';
import { getErrorLogs, saveErrorLog } from '../../lib/storage';

interface ErrorLog {
  id: string;
  message: string;
  stack?: string;
  context?: Record<string, any>;
  timestamp: string;
}

interface UseErrorLoggerReturn {
  logs: ErrorLog[];
  logError: (error: Error, context?: Record<string, any>) => Promise<void>;
  retrieveLogs: () => Promise<void>;
  clearLogs: () => Promise<void>;
  exportLogs: () => string;
}

export function useErrorLogger(): UseErrorLoggerReturn {
  const [logs, setLogs] = useState<ErrorLog[]>([]);

  const logError = useCallback(async (error: Error, context?: Record<string, any>) => {
    const log: ErrorLog = {
      id: crypto.randomUUID(),
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
    };
    
    await saveErrorLog(log);
    setLogs(prev => [...prev, log]);
  }, []);

  const retrieveLogs = useCallback(async () => {
    const storedLogs = await getErrorLogs();
    setLogs(storedLogs);
  }, []);

  const clearLogs = useCallback(async () => {
    setLogs([]);
  }, []);

  const exportLogs = useCallback(() => {
    return JSON.stringify(logs, null, 2);
  }, [logs]);

  return {
    logs,
    logError,
    retrieveLogs,
    clearLogs,
    exportLogs,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run hooks/useErrorLogger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/hooks/useErrorLogger.ts packages/extension/entrypoints/sidepanel/hooks/useErrorLogger.test.ts
git commit -m "feat: add useErrorLogger hook"
```

### Task 5: 集成错误日志到主界面

**Covers:** [S3]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/App.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import { useErrorLogger } from './hooks/useErrorLogger';

jest.mock('./hooks/useErrorLogger');
jest.mock('./hooks/useErrorHandler');
jest.mock('./hooks/useKeyboardShortcuts');
jest.mock('./hooks/useAutoSave');
jest.mock('../../lib/messaging', () => ({
  requestGenerate: jest.fn().mockRejectedValue(new Error('测试错误')),
  requestFill: jest.fn(),
  buildPrompt: jest.fn(),
}));
jest.mock('../../lib/storage', () => ({
  getSettings: jest.fn().mockResolvedValue({ promptTemplate: '' }),
  getCurrentDraft: jest.fn().mockResolvedValue(null),
  saveCurrentDraft: jest.fn(),
  clearCurrentDraft: jest.fn(),
}));
jest.mock('../../lib/auth-client', () => ({
  isAuthenticated: jest.fn().mockResolvedValue(true),
}));

describe('App with error logging', () => {
  beforeEach(() => {
    const mockErrorLogger = useErrorLogger as jest.Mock;
    mockErrorLogger.mockReturnValue({
      logs: [],
      logError: jest.fn(),
      retrieveLogs: jest.fn(),
      clearLogs: jest.fn(),
      exportLogs: jest.fn().mockReturnValue('[]'),
    });
  });

  it('logs error when generation fails', async () => {
    const mockErrorLogger = useErrorLogger as jest.Mock;
    const mockLogError = jest.fn();
    mockErrorLogger.mockReturnValue({
      logs: [],
      logError: mockLogError,
      retrieveLogs: jest.fn(),
      clearLogs: jest.fn(),
      exportLogs: jest.fn().mockReturnValue('[]'),
    });
    
    render(<App />);
    
    // 模拟用户操作
    fireEvent.change(screen.getByPlaceholderText('输入选题/主题...'), {
      target: { value: '测试选题' },
    });
    
    // 点击生成草稿
    fireEvent.click(screen.getByText('生成草稿'));
    
    // 等待错误处理
    await waitFor(() => {
      expect(mockLogError).toHaveBeenCalled();
    });
  });

  it('shows error logs panel', async () => {
    const mockErrorLogger = useErrorLogger as jest.Mock;
    mockErrorLogger.mockReturnValue({
      logs: [
        { id: '1', message: '历史错误', timestamp: new Date().toISOString() },
      ],
      logError: jest.fn(),
      retrieveLogs: jest.fn(),
      clearLogs: jest.fn(),
      exportLogs: jest.fn().mockReturnValue('[{"message":"历史错误"}]'),
    });
    
    render(<App />);
    
    // 点击错误日志按钮
    fireEvent.click(screen.getByLabelText('错误日志'));
    
    // 验证错误日志显示
    expect(screen.getByText('历史错误')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: FAIL with "useErrorLogger is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/App.tsx
// 在文件顶部添加导入
import { useErrorLogger } from './hooks/useErrorLogger';

// 在 App 组件内部添加 hook 调用
export function App() {
  // ... 现有状态
  const { logs, logError, retrieveLogs, clearLogs, exportLogs } = useErrorLogger();
  const [showLogs, setShowLogs] = useState(false);

  // 修改 handleGenerate 函数
  async function handleGenerate() {
    if (!topic.trim()) {
      handleError('请先输入主题。');
      return;
    }
    clearError();
    setResults([]);
    setMode('generating');
    
    try {
      const result = await retry(async () => {
        const token = ++genTokenRef.current;
        const res = await requestGenerate(
          buildPrompt(promptTemplateRef.current, topic),
        );
        
        if (token !== genTokenRef.current) return null;
        
        if (res.ok) {
          updateDraft(res.draft);
          setMode('draft');
          return res;
        } else {
          throw new Error(
            res.kind === 'no-key' ? `${res.error}(点右上角设置)` : res.error,
          );
        }
      });
      
      if (!result) {
        setMode(draft ? 'draft' : 'empty');
        await logError(new Error(error || '生成失败'), { topic, action: 'generate' });
      }
    } catch (err) {
      await logError(err instanceof Error ? err : new Error(String(err)), { topic, action: 'generate' });
    }
  }

  // 在 JSX 中添加错误日志按钮和面板
  return (
    <Wrap>
      {/* ... 现有 JSX */}
      
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <h1 style={{ fontSize: 16, margin: 0 }}>51publisher 填充助手</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* ... 现有按钮 */}
          <button
            onClick={() => {
              setShowLogs(!showLogs);
              if (!showLogs) retrieveLogs();
            }}
            className="btn btn-plain"
            aria-label="错误日志"
          >
            📋 日志
          </button>
        </div>
      </div>
      
      {showLogs && (
        <div
          style={{
            background: '#f5f5f5',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>错误日志</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  const exported = exportLogs();
                  navigator.clipboard?.writeText(exported);
                }}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: '#1677ff',
                }}
              >
                导出
              </button>
              <button
                onClick={clearLogs}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: '#ff4d4f',
                }}
              >
                清空
              </button>
            </div>
          </div>
          
          {logs.length === 0 ? (
            <div style={{ fontSize: 13, color: '#8c8c8c' }}>暂无错误日志</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {logs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    background: 'white',
                    border: '1px solid #d9d9d9',
                    borderRadius: 4,
                    padding: 8,
                    fontSize: 12,
                  }}
                >
                  <div style={{ color: '#cf1322', marginBottom: 4 }}>{log.message}</div>
                  <div style={{ color: '#8c8c8c' }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* ... 其余 JSX */}
    </Wrap>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/App.tsx
git commit -m "feat: integrate error logging into App"
```