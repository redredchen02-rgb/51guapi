# 状态管理优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现跨视图状态持久化，优化草稿保存和恢复机制，添加操作历史记录

**Architecture:** 使用 React Context 和自定义 Hook 管理全局状态，添加状态持久化逻辑

**Tech Stack:** React, TypeScript, Chrome Storage API

---

### Task 1: 创建全局状态 Context

**Covers:** [S4]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/context/AppContext.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/context/AppContext.test.tsx
import { render, screen } from '@testing-library/react';
import { AppProvider, useAppContext } from './AppContext';

function TestComponent() {
  const { topic, setTopic, draft, setDraft } = useAppContext();
  
  return (
    <div>
      <span data-testid="topic">{topic}</span>
      <span data-testid="draft">{draft?.title ?? '无草稿'}</span>
      <button onClick={() => setTopic('测试主题')}>设置主题</button>
      <button onClick={() => setDraft({ id: '1', title: '测试草稿' } as any)}>设置草稿</button>
    </div>
  );
}

describe('AppContext', () => {
  it('provides initial state', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    
    expect(screen.getByTestId('topic')).toHaveTextContent('');
    expect(screen.getByTestId('draft')).toHaveTextContent('无草稿');
  });

  it('updates topic', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    
    screen.getByText('设置主题').click();
    
    expect(screen.getByTestId('topic')).toHaveTextContent('测试主题');
  });

  it('updates draft', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    
    screen.getByText('设置草稿').click();
    
    expect(screen.getByTestId('draft')).toHaveTextContent('测试草稿');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run context/AppContext.test.tsx`
Expected: FAIL with "Cannot find module './AppContext'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/context/AppContext.tsx
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { ContentDraft } from '@51publisher/shared';

interface AppState {
  topic: string;
  draft: ContentDraft | null;
  mode: 'empty' | 'generating' | 'draft' | 'filling' | 'filled' | 'partial';
  error: string;
  results: Array<{ field: string; status: string; note?: string }>;
}

interface AppContextType extends AppState {
  setTopic: (topic: string) => void;
  setDraft: (draft: ContentDraft | null) => void;
  setMode: (mode: AppState['mode']) => void;
  setError: (error: string) => void;
  setResults: (results: AppState['results']) => void;
  reset: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

const initialState: AppState = {
  topic: '',
  draft: null,
  mode: 'empty',
  error: '',
  results: [],
};

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [state, setState] = useState<AppState>(initialState);

  const setTopic = useCallback((topic: string) => {
    setState(prev => ({ ...prev, topic }));
  }, []);

  const setDraft = useCallback((draft: ContentDraft | null) => {
    setState(prev => ({ ...prev, draft }));
  }, []);

  const setMode = useCallback((mode: AppState['mode']) => {
    setState(prev => ({ ...prev, mode }));
  }, []);

  const setError = useCallback((error: string) => {
    setState(prev => ({ ...prev, error }));
  }, []);

  const setResults = useCallback((results: AppState['results']) => {
    setState(prev => ({ ...prev, results }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return (
    <AppContext.Provider
      value={{
        ...state,
        setTopic,
        setDraft,
        setMode,
        setError,
        setResults,
        reset,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run context/AppContext.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/context/AppContext.tsx packages/extension/entrypoints/sidepanel/context/AppContext.test.tsx
git commit -m "feat: add AppContext for global state management"
```

### Task 2: 添加状态持久化 Hook

**Covers:** [S4]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/usePersistedState.ts`
- Modify: `packages/extension/entrypoints/sidepanel/context/AppContext.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/usePersistedState.test.ts
import { renderHook, act } from '@testing-library/react';
import { usePersistedState } from './usePersistedState';

jest.mock('../../lib/storage', () => ({
  getLocalStorage: jest.fn().mockResolvedValue(null),
  setLocalStorage: jest.fn().mockResolvedValue(undefined),
}));

describe('usePersistedState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads initial value from storage', async () => {
    const storage = require('../../lib/storage');
    storage.getLocalStorage.mockResolvedValue('持久化值');
    
    const { result, waitForNextUpdate } = renderHook(() => 
      usePersistedState('testKey', '默认值')
    );
    
    expect(result.current[0]).toBe('默认值');
    
    await waitForNextUpdate();
    
    expect(result.current[0]).toBe('持久化值');
  });

  it('saves value to storage', async () => {
    const storage = require('../../lib/storage');
    
    const { result } = renderHook(() => 
      usePersistedState('testKey', '默认值')
    );
    
    await act(async () => {
      result.current[1]('新值');
    });
    
    expect(storage.setLocalStorage).toHaveBeenCalledWith('testKey', '新值');
  });

  it('handles storage errors', async () => {
    const storage = require('../../lib/storage');
    storage.getLocalStorage.mockRejectedValue(new Error('存储错误'));
    
    const { result, waitForNextUpdate } = renderHook(() => 
      usePersistedState('testKey', '默认值')
    );
    
    expect(result.current[0]).toBe('默认值');
    
    await waitForNextUpdate();
    
    expect(result.current[0]).toBe('默认值');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run hooks/usePersistedState.test.ts`
Expected: FAIL with "Cannot find module './usePersistedState'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/usePersistedState.ts
import { useState, useEffect, useCallback } from 'react';
import { getLocalStorage, setLocalStorage } from '../../lib/storage';

export function usePersistedState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(defaultValue);
  const [isLoaded, setIsLoaded] = useState(false);

  // 从存储加载初始值
  useEffect(() => {
    let cancelled = false;
    
    async function loadFromStorage() {
      try {
        const stored = await getLocalStorage(key);
        if (!cancelled && stored !== null) {
          setState(stored as T);
        }
      } catch (error) {
        console.warn(`[usePersistedState] Failed to load ${key}:`, error);
      } finally {
        if (!cancelled) {
          setIsLoaded(true);
        }
      }
    }
    
    loadFromStorage();
    
    return () => {
      cancelled = true;
    };
  }, [key]);

  // 保存到存储
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState(prev => {
        const newValue = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
        
        // 异步保存到存储
        setLocalStorage(key, newValue).catch(error => {
          console.warn(`[usePersistedState] Failed to save ${key}:`, error);
        });
        
        return newValue;
      });
    },
    [key],
  );

  return [state, setValue];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run hooks/usePersistedState.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/hooks/usePersistedState.ts packages/extension/entrypoints/sidepanel/hooks/usePersistedState.test.ts
git commit -m "feat: add usePersistedState hook"
```

### Task 3: 集成状态持久化到 Context

**Covers:** [S4]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/context/AppContext.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/context/AppContext.test.tsx
import { render, screen, act } from '@testing-library/react';
import { AppProvider, useAppContext } from './AppContext';
import { usePersistedState } from '../hooks/usePersistedState';

jest.mock('../hooks/usePersistedState');
jest.mock('../../lib/storage', () => ({
  getLocalStorage: jest.fn().mockResolvedValue(null),
  setLocalStorage: jest.fn().mockResolvedValue(undefined),
}));

function TestComponent() {
  const { topic, setTopic } = useAppContext();
  
  return (
    <div>
      <span data-testid="topic">{topic}</span>
      <button onClick={() => setTopic('持久化主题')}>设置主题</button>
    </div>
  );
}

describe('AppContext with persistence', () => {
  beforeEach(() => {
    const mockUsePersistedState = usePersistedState as jest.Mock;
    mockUsePersistedState.mockReturnValue(['', jest.fn()]);
  });

  it('persists topic changes', async () => {
    const mockSetTopic = jest.fn();
    const mockUsePersistedState = usePersistedState as jest.Mock;
    mockUsePersistedState.mockReturnValue(['', mockSetTopic]);
    
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    
    await act(async () => {
      screen.getByText('设置主题').click();
    });
    
    expect(mockSetTopic).toHaveBeenCalledWith('持久化主题');
  });

  it('loads persisted topic on mount', async () => {
    const mockUsePersistedState = usePersistedState as jest.Mock;
    mockUsePersistedState.mockReturnValue(['持久化主题', jest.fn()]);
    
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    
    expect(screen.getByTestId('topic')).toHaveTextContent('持久化主题');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run context/AppContext.test.tsx`
Expected: FAIL with "usePersistedState is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/context/AppContext.tsx
// 在文件顶部添加导入
import { usePersistedState } from '../hooks/usePersistedState';

// 修改 AppProvider 组件
export function AppProvider({ children }: AppProviderProps) {
  // 使用持久化状态
  const [topic, setTopicPersisted] = usePersistedState('app-topic', '');
  const [draft, setDraftPersisted] = usePersistedState<ContentDraft | null>('app-draft', null);
  const [mode, setModePersisted] = usePersistedState<AppState['mode']>('app-mode', 'empty');
  const [error, setErrorPersisted] = usePersistedState('app-error', '');
  const [results, setResultsPersisted] = usePersistedState<AppState['results']>('app-results', []);

  const setTopic = useCallback((value: string | ((prev: string) => string)) => {
    setTopicPersisted(value);
  }, [setTopicPersisted]);

  const setDraft = useCallback((value: ContentDraft | null | ((prev: ContentDraft | null) => ContentDraft | null)) => {
    setDraftPersisted(value);
  }, [setDraftPersisted]);

  const setMode = useCallback((value: AppState['mode'] | ((prev: AppState['mode']) => AppState['mode'])) => {
    setModePersisted(value);
  }, [setModePersisted]);

  const setError = useCallback((value: string | ((prev: string) => string)) => {
    setErrorPersisted(value);
  }, [setErrorPersisted]);

  const setResults = useCallback((value: AppState['results'] | ((prev: AppState['results']) => AppState['results'])) => {
    setResultsPersisted(value);
  }, [setResultsPersisted]);

  const reset = useCallback(() => {
    setTopicPersisted('');
    setDraftPersisted(null);
    setModePersisted('empty');
    setErrorPersisted('');
    setResultsPersisted([]);
  }, [setTopicPersisted, setDraftPersisted, setModePersisted, setErrorPersisted, setResultsPersisted]);

  return (
    <AppContext.Provider
      value={{
        topic,
        draft,
        mode,
        error,
        results,
        setTopic,
        setDraft,
        setMode,
        setError,
        setResults,
        reset,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run context/AppContext.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/context/AppContext.tsx
git commit -m "feat: integrate state persistence into AppContext"
```

### Task 4: 创建操作历史 Hook

**Covers:** [S4]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useOperationHistory.ts`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useOperationHistory.test.ts
import { renderHook, act } from '@testing-library/react';
import { useOperationHistory } from './useOperationHistory';

jest.mock('../../lib/storage', () => ({
  getOperationHistory: jest.fn().mockResolvedValue([]),
  saveOperationHistory: jest.fn().mockResolvedValue(undefined),
}));

describe('useOperationHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with empty history', async () => {
    const { result, waitForNextUpdate } = renderHook(() => useOperationHistory());
    
    expect(result.current.history).toEqual([]);
    
    await waitForNextUpdate();
  });

  it('records operation', async () => {
    const { result, waitForNextUpdate } = renderHook(() => useOperationHistory());
    
    await waitForNextUpdate();
    
    await act(async () => {
      await result.current.recordOperation({
        type: 'generate',
        topic: '测试选题',
        success: true,
      });
    });
    
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].type).toBe('generate');
  });

  it('retrieves history', async () => {
    const storage = require('../../lib/storage');
    storage.getOperationHistory.mockResolvedValue([
      { id: '1', type: 'generate', topic: '历史操作', timestamp: new Date().toISOString() },
    ]);
    
    const { result, waitForNextUpdate } = renderHook(() => useOperationHistory());
    
    await waitForNextUpdate();
    
    await act(async () => {
      await result.current.retrieveHistory();
    });
    
    expect(result.current.history).toHaveLength(1);
  });

  it('clears history', async () => {
    const storage = require('../../lib/storage');
    storage.getOperationHistory.mockResolvedValue([
      { id: '1', type: 'generate', topic: '历史操作', timestamp: new Date().toISOString() },
    ]);
    
    const { result, waitForNextUpdate } = renderHook(() => useOperationHistory());
    
    await waitForNextUpdate();
    
    await act(async () => {
      await result.current.retrieveHistory();
    });
    
    await act(async () => {
      await result.current.clearHistory();
    });
    
    expect(result.current.history).toEqual([]);
  });

  it('exports history', async () => {
    const { result, waitForNextUpdate } = renderHook(() => useOperationHistory());
    
    await waitForNextUpdate();
    
    await act(async () => {
      await result.current.recordOperation({
        type: 'generate',
        topic: '测试选题',
        success: true,
      });
    });
    
    const exported = result.current.exportHistory();
    expect(exported).toContain('测试选题');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run hooks/useOperationHistory.test.ts`
Expected: FAIL with "Cannot find module './useOperationHistory'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useOperationHistory.ts
import { useState, useEffect, useCallback } from 'react';
import { getOperationHistory, saveOperationHistory } from '../../lib/storage';

interface OperationRecord {
  id: string;
  type: 'generate' | 'fill' | 'publish' | 'error';
  topic: string;
  success: boolean;
  details?: Record<string, any>;
  timestamp: string;
}

interface UseOperationHistoryReturn {
  history: OperationRecord[];
  recordOperation: (operation: Omit<OperationRecord, 'id' | 'timestamp'>) => Promise<void>;
  retrieveHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
  exportHistory: () => string;
}

export function useOperationHistory(): UseOperationHistoryReturn {
  const [history, setHistory] = useState<OperationRecord[]>([]);

  // 初始加载
  useEffect(() => {
    let cancelled = false;
    
    async function loadHistory() {
      try {
        const stored = await getOperationHistory();
        if (!cancelled) {
          setHistory(stored);
        }
      } catch (error) {
        console.warn('[useOperationHistory] Failed to load history:', error);
      }
    }
    
    loadHistory();
    
    return () => {
      cancelled = true;
    };
  }, []);

  const recordOperation = useCallback(async (operation: Omit<OperationRecord, 'id' | 'timestamp'>) => {
    const record: OperationRecord = {
      ...operation,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    
    setHistory(prev => {
      const newHistory = [record, ...prev].slice(0, 100); // 保留最近 100 条
      saveOperationHistory(newHistory).catch(error => {
        console.warn('[useOperationHistory] Failed to save history:', error);
      });
      return newHistory;
    });
  }, []);

  const retrieveHistory = useCallback(async () => {
    try {
      const stored = await getOperationHistory();
      setHistory(stored);
    } catch (error) {
      console.warn('[useOperationHistory] Failed to retrieve history:', error);
    }
  }, []);

  const clearHistory = useCallback(async () => {
    setHistory([]);
    await saveOperationHistory([]).catch(error => {
      console.warn('[useOperationHistory] Failed to clear history:', error);
    });
  }, []);

  const exportHistory = useCallback(() => {
    return JSON.stringify(history, null, 2);
  }, [history]);

  return {
    history,
    recordOperation,
    retrieveHistory,
    clearHistory,
    exportHistory,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run hooks/useOperationHistory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/hooks/useOperationHistory.ts packages/extension/entrypoints/sidepanel/hooks/useOperationHistory.test.ts
git commit -m "feat: add useOperationHistory hook"
```

### Task 5: 集成操作历史到主界面

**Covers:** [S4]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/App.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import { useOperationHistory } from './hooks/useOperationHistory';

jest.mock('./hooks/useOperationHistory');
jest.mock('./hooks/useErrorHandler');
jest.mock('./hooks/useKeyboardShortcuts');
jest.mock('./hooks/useAutoSave');
jest.mock('../../lib/messaging', () => ({
  requestGenerate: jest.fn().mockResolvedValue({ ok: true, draft: { title: '测试' } }),
  requestFill: jest.fn().mockResolvedValue({ ok: true, results: [] }),
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

describe('App with operation history', () => {
  beforeEach(() => {
    const mockOperationHistory = useOperationHistory as jest.Mock;
    mockOperationHistory.mockReturnValue({
      history: [],
      recordOperation: jest.fn(),
      retrieveHistory: jest.fn(),
      clearHistory: jest.fn(),
      exportHistory: jest.fn().mockReturnValue('[]'),
    });
  });

  it('records generation operation', async () => {
    const mockOperationHistory = useOperationHistory as jest.Mock;
    const mockRecordOperation = jest.fn();
    mockOperationHistory.mockReturnValue({
      history: [],
      recordOperation: mockRecordOperation,
      retrieveHistory: jest.fn(),
      clearHistory: jest.fn(),
      exportHistory: jest.fn().mockReturnValue('[]'),
    });
    
    render(<App />);
    
    // 模拟用户操作
    fireEvent.change(screen.getByPlaceholderText('输入选题/主题...'), {
      target: { value: '测试选题' },
    });
    
    // 点击生成草稿
    fireEvent.click(screen.getByText('生成草稿'));
    
    // 等待生成完成
    await waitFor(() => {
      expect(screen.getByText('填充到当前页')).toBeInTheDocument();
    });
    
    expect(mockRecordOperation).toHaveBeenCalledWith({
      type: 'generate',
      topic: '测试选题',
      success: true,
    });
  });

  it('shows operation history panel', async () => {
    const mockOperationHistory = useOperationHistory as jest.Mock;
    mockOperationHistory.mockReturnValue({
      history: [
        { id: '1', type: 'generate', topic: '历史选题', success: true, timestamp: new Date().toISOString() },
      ],
      recordOperation: jest.fn(),
      retrieveHistory: jest.fn(),
      clearHistory: jest.fn(),
      exportHistory: jest.fn().mockReturnValue('[{"topic":"历史选题"}]'),
    });
    
    render(<App />);
    
    // 点击历史按钮
    fireEvent.click(screen.getByLabelText('操作历史'));
    
    // 验证历史显示
    expect(screen.getByText('历史选题')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: FAIL with "useOperationHistory is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/App.tsx
// 在文件顶部添加导入
import { useOperationHistory } from './hooks/useOperationHistory';

// 在 App 组件内部添加 hook 调用
export function App() {
  // ... 现有状态
  const { history, recordOperation, retrieveHistory, clearHistory, exportHistory } = useOperationHistory();
  const [showHistory, setShowHistory] = useState(false);

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
          
          // 记录操作
          await recordOperation({
            type: 'generate',
            topic,
            success: true,
          });
          
          return res;
        } else {
          throw new Error(
            res.kind === 'no-key' ? `${res.error}(点右上角设置)` : res.error,
          );
        }
      });
      
      if (!result) {
        setMode(draft ? 'draft' : 'empty');
        
        // 记录失败操作
        await recordOperation({
          type: 'generate',
          topic,
          success: false,
          details: { error },
        });
      }
    } catch (err) {
      await recordOperation({
        type: 'generate',
        topic,
        success: false,
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // 在 JSX 中添加操作历史按钮和面板
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
              setShowHistory(!showHistory);
              if (!showHistory) retrieveHistory();
            }}
            className="btn btn-plain"
            aria-label="操作历史"
          >
            📜 历史
          </button>
        </div>
      </div>
      
      {showHistory && (
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
            <span style={{ fontWeight: 600 }}>操作历史</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  const exported = exportHistory();
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
                onClick={clearHistory}
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
          
          {history.length === 0 ? (
            <div style={{ fontSize: 13, color: '#8c8c8c' }}>暂无操作历史</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map((record) => (
                <div
                  key={record.id}
                  style={{
                    background: 'white',
                    border: '1px solid #d9d9d9',
                    borderRadius: 4,
                    padding: 8,
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{record.topic}</span>
                    <span style={{ color: record.success ? '#389e0d' : '#cf1322' }}>
                      {record.success ? '成功' : '失败'}
                    </span>
                  </div>
                  <div style={{ color: '#8c8c8c' }}>
                    {record.type === 'generate' ? '生成' : record.type === 'fill' ? '填充' : '发布'}
                    {' · '}
                    {new Date(record.timestamp).toLocaleString()}
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
git commit -m "feat: integrate operation history into App"
```