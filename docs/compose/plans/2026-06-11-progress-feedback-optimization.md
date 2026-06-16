# 进度反馈优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为生成草稿和填充页面添加实时进度反馈，提升用户等待体验

**Architecture:** 使用 React 状态管理和定时器实现进度条，添加操作成功/失败的即时反馈

**Tech Stack:** React, TypeScript, CSS

---

### Task 1: 创建进度条组件

**Covers:** [S1]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/components/ProgressBar.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/components/ProgressBar.test.tsx
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders with correct progress', () => {
    render(<ProgressBar progress={50} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('renders with 0 progress', () => {
    render(<ProgressBar progress={0} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('renders with 100 progress', () => {
    render(<ProgressBar progress={100} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run components/ProgressBar.test.tsx`
Expected: FAIL with "Cannot find module './ProgressBar'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/components/ProgressBar.tsx
import React from 'react';

interface ProgressBarProps {
  progress: number;
  label?: string;
}

export function ProgressBar({ progress, label }: ProgressBarProps) {
  return (
    <div style={{ width: '100%', height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
      <div
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: `${progress}%`,
          height: '100%',
          background: '#1677ff',
          transition: 'width 0.3s ease',
        }}
      />
      {label && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{label}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run components/ProgressBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/components/ProgressBar.tsx packages/extension/entrypoints/sidepanel/components/ProgressBar.test.tsx
git commit -m "feat: add ProgressBar component"
```

### Task 2: 添加加载状态管理

**Covers:** [S1]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useLoadingState.ts`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useLoadingState.test.ts
import { renderHook, act } from '@testing-library/react';
import { useLoadingState } from './useLoadingState';

describe('useLoadingState', () => {
  it('initializes with idle state', () => {
    const { result } = renderHook(() => useLoadingState());
    expect(result.current.state).toBe('idle');
    expect(result.current.progress).toBe(0);
  });

  it('transitions to loading state', () => {
    const { result } = renderHook(() => useLoadingState());
    act(() => {
      result.current.startLoading('正在生成草稿...');
    });
    expect(result.current.state).toBe('loading');
    expect(result.current.message).toBe('正在生成草稿...');
  });

  it('updates progress', () => {
    const { result } = renderHook(() => useLoadingState());
    act(() => {
      result.current.startLoading('正在生成草稿...');
    });
    act(() => {
      result.current.updateProgress(50);
    });
    expect(result.current.progress).toBe(50);
  });

  it('completes loading', () => {
    const { result } = renderHook(() => useLoadingState());
    act(() => {
      result.current.startLoading('正在生成草稿...');
    });
    act(() => {
      result.current.completeLoading();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.progress).toBe(0);
  });

  it('handles error', () => {
    const { result } = renderHook(() => useLoadingState());
    act(() => {
      result.current.startLoading('正在生成草稿...');
    });
    act(() => {
      result.current.handleError('生成失败');
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error).toBe('生成失败');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run hooks/useLoadingState.test.ts`
Expected: FAIL with "Cannot find module './useLoadingState'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useLoadingState.ts
import { useState, useCallback } from 'react';

type LoadingState = 'idle' | 'loading' | 'error';

interface UseLoadingStateReturn {
  state: LoadingState;
  progress: number;
  message: string;
  error: string;
  startLoading: (message: string) => void;
  updateProgress: (progress: number) => void;
  completeLoading: () => void;
  handleError: (error: string) => void;
}

export function useLoadingState(): UseLoadingStateReturn {
  const [state, setState] = useState<LoadingState>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const startLoading = useCallback((msg: string) => {
    setState('loading');
    setProgress(0);
    setMessage(msg);
    setError('');
  }, []);

  const updateProgress = useCallback((p: number) => {
    setProgress(p);
  }, []);

  const completeLoading = useCallback(() => {
    setState('idle');
    setProgress(0);
    setMessage('');
    setError('');
  }, []);

  const handleError = useCallback((err: string) => {
    setState('error');
    setError(err);
    setProgress(0);
  }, []);

  return {
    state,
    progress,
    message,
    error,
    startLoading,
    updateProgress,
    completeLoading,
    handleError,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run hooks/useLoadingState.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/hooks/useLoadingState.ts packages/extension/entrypoints/sidepanel/hooks/useLoadingState.test.ts
git commit -m "feat: add useLoadingState hook"
```

### Task 3: 集成进度反馈到主界面

**Covers:** [S1]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/App.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import { useLoadingState } from './hooks/useLoadingState';

jest.mock('./hooks/useLoadingState');
jest.mock('../../lib/messaging', () => ({
  requestGenerate: jest.fn(),
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

describe('App with progress feedback', () => {
  it('shows loading state during generation', async () => {
    const mockUseLoadingState = useLoadingState as jest.Mock;
    mockUseLoadingState.mockReturnValue({
      state: 'loading',
      progress: 30,
      message: '正在生成草稿...',
      error: '',
      startLoading: jest.fn(),
      updateProgress: jest.fn(),
      completeLoading: jest.fn(),
      handleError: jest.fn(),
    });

    render(<App />);
    
    expect(screen.getByText('正在生成草稿...')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
  });

  it('shows error state when generation fails', async () => {
    const mockUseLoadingState = useLoadingState as jest.Mock;
    mockUseLoadingState.mockReturnValue({
      state: 'error',
      progress: 0,
      message: '',
      error: '生成失败，请重试',
      startLoading: jest.fn(),
      updateProgress: jest.fn(),
      completeLoading: jest.fn(),
      handleError: jest.fn(),
    });

    render(<App />);
    
    expect(screen.getByText('生成失败，请重试')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: FAIL with "useLoadingState is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/App.tsx
// 在文件顶部添加导入
import { ProgressBar } from './components/ProgressBar';
import { useLoadingState } from './hooks/useLoadingState';

// 在 App 组件内部添加状态管理
export function App() {
  // ... 现有状态
  const loadingState = useLoadingState();

  // 修改 handleGenerate 函数
  async function handleGenerate() {
    if (!topic.trim()) {
      setError('请先输入主题。');
      return;
    }
    setError('');
    setResults([]);
    loadingState.startLoading('正在生成草稿...');
    
    // 模拟进度更新
    const progressInterval = setInterval(() => {
      loadingState.updateProgress(Math.min(loadingState.progress + 10, 90));
    }, 500);
    
    try {
      const token = ++genTokenRef.current;
      const res = await requestGenerate(
        buildPrompt(promptTemplateRef.current, topic),
      );
      
      if (token !== genTokenRef.current) return;
      
      if (res.ok) {
        updateDraft(res.draft);
        setMode('draft');
        loadingState.completeLoading();
      } else {
        setError(
          res.kind === 'no-key' ? `${res.error}(点右上角设置)` : res.error,
        );
        setMode(draft ? 'draft' : 'empty');
        loadingState.handleError(res.error);
      }
    } finally {
      clearInterval(progressInterval);
    }
  }

  // 在 JSX 中添加进度条
  return (
    <Wrap>
      {/* ... 现有 JSX */}
      
      {loadingState.state === 'loading' && (
        <div style={{ marginBottom: 12 }}>
          <ProgressBar progress={loadingState.progress} label={loadingState.message} />
        </div>
      )}
      
      {loadingState.state === 'error' && (
        <div style={{ marginBottom: 12, color: '#cf1322', fontSize: 13 }}>
          {loadingState.error}
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
git commit -m "feat: integrate progress feedback into App"
```

### Task 4: 添加操作成功反馈

**Covers:** [S1]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/components/Toast.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/components/Toast.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Toast } from './Toast';

describe('Toast', () => {
  it('renders success message', () => {
    render(<Toast message="操作成功" type="success" />);
    expect(screen.getByText('操作成功')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveStyle({ background: '#f6ffed' });
  });

  it('renders error message', () => {
    render(<Toast message="操作失败" type="error" />);
    expect(screen.getByText('操作失败')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveStyle({ background: '#fff1f0' });
  });

  it('calls onClose after timeout', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    render(<Toast message="操作成功" type="success" onClose={onClose} />);
    
    jest.advanceTimersByTime(3000);
    
    expect(onClose).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = jest.fn();
    render(<Toast message="操作成功" type="success" onClose={onClose} />);
    
    fireEvent.click(screen.getByLabelText('关闭'));
    
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run components/Toast.test.tsx`
Expected: FAIL with "Cannot find module './Toast'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/components/Toast.tsx
import React, { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose?: () => void;
  duration?: number;
}

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    if (!onClose) return;
    
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const backgroundColor = {
    success: '#f6ffed',
    error: '#fff1f0',
    info: '#e6f7ff',
  }[type];

  const borderColor = {
    success: '#b7eb8f',
    error: '#ffa39e',
    info: '#91d5ff',
  }[type];

  return (
    <div
      role="alert"
      style={{
        background: backgroundColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 4,
        padding: '8px 12px',
        marginBottom: 8,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>{message}</span>
      {onClose && (
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: 12,
            color: '#666',
            padding: '0 4px',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run components/Toast.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/components/Toast.tsx packages/extension/entrypoints/sidepanel/components/Toast.test.tsx
git commit -m "feat: add Toast component for success feedback"
```

### Task 5: 集成 Toast 到主界面

**Covers:** [S1]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/App.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';

jest.mock('./hooks/useLoadingState');
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

describe('App with Toast', () => {
  it('shows success toast after fill', async () => {
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
    
    // 点击填充
    fireEvent.click(screen.getByText('填充到当前页'));
    
    // 等待填充完成
    await waitFor(() => {
      expect(screen.getByText('填充成功')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: FAIL with "Toast is not defined"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/App.tsx
// 在文件顶部添加导入
import { Toast } from './components/Toast';

// 在 App 组件内部添加状态
export function App() {
  // ... 现有状态
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // 修改 handleFill 函数
  async function handleFill() {
    if (!draft) return;
    setError('');
    setMode('filling');
    const res = await requestFill(draft);
    if (res.ok) {
      setResults(res.results);
      const anyProblem = res.results.some((r) => r.status !== 'filled');
      setMode(anyProblem ? 'partial' : 'filled');
      if (!anyProblem) {
        setToast({ message: '填充成功', type: 'success' });
      }
    } else {
      setError(res.error);
      setMode('draft');
      setToast({ message: res.error, type: 'error' });
    }
  }

  // 在 JSX 中添加 Toast
  return (
    <Wrap>
      {/* ... 现有 JSX */}
      
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
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
git commit -m "feat: integrate Toast for success feedback"
```