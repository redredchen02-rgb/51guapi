# 交互流程简化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简化批量操作流程，支持快捷键，优化表单填写体验

**Architecture:** 使用 React Hook 管理快捷键，添加自动保存功能，优化批量操作流程

**Tech Stack:** React, TypeScript, CSS

---

### Task 1: 创建快捷键 Hook

**Covers:** [S2]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useKeyboardShortcuts.ts`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useKeyboardShortcuts.test.ts
import { renderHook, act } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  it('registers keyboard shortcuts', () => {
    const onGenerate = jest.fn();
    const { result } = renderHook(() => useKeyboardShortcuts({ onGenerate }));
    
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true });
      window.dispatchEvent(event);
    });
    
    expect(onGenerate).toHaveBeenCalled();
  });

  it('does not trigger on non-shortcut keys', () => {
    const onGenerate = jest.fn();
    const { result } = renderHook(() => useKeyboardShortcuts({ onGenerate }));
    
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'a' });
      window.dispatchEvent(event);
    });
    
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('cleans up event listener on unmount', () => {
    const onGenerate = jest.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ onGenerate }));
    
    unmount();
    
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true });
      window.dispatchEvent(event);
    });
    
    expect(onGenerate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run hooks/useKeyboardShortcuts.test.ts`
Expected: FAIL with "Cannot find module './useKeyboardShortcuts'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useKeyboardShortcuts.ts
import { useEffect } from 'react';

interface KeyboardShortcutsOptions {
  onGenerate?: () => void;
  onFill?: () => void;
  onNext?: () => void;
  onSave?: () => void;
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Ctrl/Cmd + Enter: 生成草稿
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        options.onGenerate?.();
      }
      
      // Ctrl/Cmd + Shift + Enter: 填充到当前页
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter') {
        event.preventDefault();
        options.onFill?.();
      }
      
      // Ctrl/Cmd + ArrowRight: 下一条
      if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowRight') {
        event.preventDefault();
        options.onNext?.();
      }
      
      // Ctrl/Cmd + S: 保存
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        options.onSave?.();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [options]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run hooks/useKeyboardShortcuts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/hooks/useKeyboardShortcuts.ts packages/extension/entrypoints/sidepanel/hooks/useKeyboardShortcuts.test.ts
git commit -m "feat: add useKeyboardShortcuts hook"
```

### Task 2: 添加自动保存功能

**Covers:** [S2]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useAutoSave.ts`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useAutoSave.test.ts
import { renderHook, act } from '@testing-library/react';
import { useAutoSave } from './useAutoSave';

jest.mock('../../lib/storage', () => ({
  saveCurrentDraft: jest.fn().mockResolvedValue(undefined),
}));

describe('useAutoSave', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('saves draft after delay', async () => {
    const { result } = renderHook(() => useAutoSave());
    const draft = { id: '1', title: '测试' };
    
    act(() => {
      result.current.saveDraft(draft as any);
    });
    
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    
    const storage = require('../../lib/storage');
    expect(storage.saveCurrentDraft).toHaveBeenCalledWith(draft);
  });

  it('debounces multiple saves', async () => {
    const { result } = renderHook(() => useAutoSave());
    const draft1 = { id: '1', title: '测试1' };
    const draft2 = { id: '2', title: '测试2' };
    
    act(() => {
      result.current.saveDraft(draft1 as any);
    });
    
    act(() => {
      jest.advanceTimersByTime(500);
    });
    
    act(() => {
      result.current.saveDraft(draft2 as any);
    });
    
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    
    const storage = require('../../lib/storage');
    expect(storage.saveCurrentDraft).toHaveBeenCalledTimes(1);
    expect(storage.saveCurrentDraft).toHaveBeenCalledWith(draft2);
  });

  it('saves immediately when saveImmediately is true', async () => {
    const { result } = renderHook(() => useAutoSave());
    const draft = { id: '1', title: '测试' };
    
    act(() => {
      result.current.saveDraft(draft as any, true);
    });
    
    const storage = require('../../lib/storage');
    expect(storage.saveCurrentDraft).toHaveBeenCalledWith(draft);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run hooks/useAutoSave.test.ts`
Expected: FAIL with "Cannot find module './useAutoSave'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useAutoSave.ts
import { useCallback, useRef } from 'react';
import { saveCurrentDraft } from '../../lib/storage';
import type { ContentDraft } from '@51publisher/shared';

interface UseAutoSaveReturn {
  saveDraft: (draft: ContentDraft, immediate?: boolean) => void;
}

export function useAutoSave(delay = 1000): UseAutoSaveReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveDraft = useCallback(
    (draft: ContentDraft, immediate = false) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      const doSave = () => {
        saveCurrentDraft(draft).catch(console.error);
      };

      if (immediate) {
        doSave();
      } else {
        timerRef.current = setTimeout(doSave, delay);
      }
    },
    [delay],
  );

  return { saveDraft };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run hooks/useAutoSave.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/hooks/useAutoSave.ts packages/extension/entrypoints/sidepanel/hooks/useAutoSave.test.ts
git commit -m "feat: add useAutoSave hook"
```

### Task 3: 集成快捷键和自动保存到主界面

**Covers:** [S2]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/App.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAutoSave } from './hooks/useAutoSave';

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

describe('App with keyboard shortcuts and auto-save', () => {
  beforeEach(() => {
    const mockUseKeyboardShortcuts = useKeyboardShortcuts as jest.Mock;
    mockUseKeyboardShortcuts.mockReturnValue(undefined);
    
    const mockUseAutoSave = useAutoSave as jest.Mock;
    mockUseAutoSave.mockReturnValue({ saveDraft: jest.fn() });
  });

  it('calls onGenerate when Ctrl+Enter is pressed', async () => {
    const mockSaveDraft = jest.fn();
    const mockUseAutoSave = useAutoSave as jest.Mock;
    mockUseAutoSave.mockReturnValue({ saveDraft: mockSaveDraft });
    
    render(<App />);
    
    // 模拟快捷键
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    
    // 验证生成函数被调用
    await waitFor(() => {
      expect(screen.getByText('正在生成草稿...')).toBeInTheDocument();
    });
  });

  it('saves draft on change', async () => {
    const mockSaveDraft = jest.fn();
    const mockUseAutoSave = useAutoSave as jest.Mock;
    mockUseAutoSave.mockReturnValue({ saveDraft: mockSaveDraft });
    
    render(<App />);
    
    // 输入主题
    fireEvent.change(screen.getByPlaceholderText('输入选题/主题...'), {
      target: { value: '测试选题' },
    });
    
    // 点击生成
    fireEvent.click(screen.getByText('生成草稿'));
    
    // 等待生成完成
    await waitFor(() => {
      expect(screen.getByText('填充到当前页')).toBeInTheDocument();
    });
    
    // 验证自动保存被调用
    expect(mockSaveDraft).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: FAIL with "useKeyboardShortcuts is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/App.tsx
// 在文件顶部添加导入
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAutoSave } from './hooks/useAutoSave';

// 在 App 组件内部添加 hook 调用
export function App() {
  // ... 现有状态
  const { saveDraft } = useAutoSave();

  // 添加快捷键支持
  useKeyboardShortcuts({
    onGenerate: handleGenerate,
    onFill: handleFill,
    onNext: handleNext,
    onSave: () => {
      if (draft) {
        saveDraft(draft, true);
      }
    },
  });

  // 修改 updateDraft 函数
  function updateDraft(next: ContentDraft) {
    setDraft(next);
    saveDraft(next);
  }

  // ... 其余代码保持不变
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/App.tsx
git commit -m "feat: integrate keyboard shortcuts and auto-save"
```

### Task 4: 添加快捷键提示

**Covers:** [S2]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/components/KeyboardShortcutsHelp.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/components/KeyboardShortcutsHelp.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';

describe('KeyboardShortcutsHelp', () => {
  it('renders shortcuts list', () => {
    render(<KeyboardShortcutsHelp />);
    expect(screen.getByText('快捷键帮助')).toBeInTheDocument();
    expect(screen.getByText('Ctrl + Enter')).toBeInTheDocument();
    expect(screen.getByText('生成草稿')).toBeInTheDocument();
  });

  it('shows help when triggered', () => {
    render(<KeyboardShortcutsHelp />);
    
    // 默认隐藏
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    
    // 点击帮助按钮
    fireEvent.click(screen.getByLabelText('快捷键帮助'));
    
    // 显示帮助对话框
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes when close button clicked', () => {
    render(<KeyboardShortcutsHelp />);
    
    // 打开帮助
    fireEvent.click(screen.getByLabelText('快捷键帮助'));
    
    // 关闭帮助
    fireEvent.click(screen.getByLabelText('关闭'));
    
    // 验证关闭
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run components/KeyboardShortcutsHelp.test.tsx`
Expected: FAIL with "Cannot find module './KeyboardShortcutsHelp'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/components/KeyboardShortcutsHelp.tsx
import React, { useState } from 'react';

interface Shortcut {
  keys: string;
  description: string;
}

const shortcuts: Shortcut[] = [
  { keys: 'Ctrl + Enter', description: '生成草稿' },
  { keys: 'Ctrl + Shift + Enter', description: '填充到当前页' },
  { keys: 'Ctrl + →', description: '下一条' },
  { keys: 'Ctrl + S', description: '保存' },
];

export function KeyboardShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="快捷键帮助"
        onClick={() => setIsOpen(true)}
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          fontSize: 12,
          color: '#666',
          padding: '0 4px',
        }}
      >
        ?
      </button>
      
      {isOpen && (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsOpen(false);
            }
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 8,
              padding: 16,
              maxWidth: 400,
              width: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16 }}>快捷键帮助</h3>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setIsOpen(false)}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 16,
                  color: '#666',
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {shortcuts.map((shortcut) => (
                <div
                  key={shortcut.keys}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{shortcut.keys}</span>
                  <span style={{ color: '#666' }}>{shortcut.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run components/KeyboardShortcutsHelp.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/components/KeyboardShortcutsHelp.tsx packages/extension/entrypoints/sidepanel/components/KeyboardShortcutsHelp.test.tsx
git commit -m "feat: add KeyboardShortcutsHelp component"
```

### Task 5: 集成快捷键帮助到主界面

**Covers:** [S2]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/App.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/App.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from './App';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';

jest.mock('./components/KeyboardShortcutsHelp');
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

describe('App with keyboard shortcuts help', () => {
  beforeEach(() => {
    const mockKeyboardShortcutsHelp = KeyboardShortcutsHelp as jest.Mock;
    mockKeyboardShortcutsHelp.mockReturnValue(null);
  });

  it('shows keyboard shortcuts help button', () => {
    render(<App />);
    expect(screen.getByLabelText('快捷键帮助')).toBeInTheDocument();
  });

  it('opens keyboard shortcuts help when clicked', () => {
    const mockKeyboardShortcutsHelp = KeyboardShortcutsHelp as jest.Mock;
    mockKeyboardShortcutsHelp.mockImplementation(({ children }) => (
      <div>{children}</div>
    ));
    
    render(<App />);
    
    fireEvent.click(screen.getByLabelText('快捷键帮助'));
    
    expect(mockKeyboardShortcutsHelp).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: FAIL with "KeyboardShortcutsHelp is not defined"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/App.tsx
// 在文件顶部添加导入
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';

// 在 JSX 中添加快捷键帮助按钮
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
        <KeyboardShortcutsHelp />
      </div>
    </div>
    
    {/* ... 其余 JSX */}
  </Wrap>
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/App.tsx
git commit -m "feat: integrate keyboard shortcuts help"
```