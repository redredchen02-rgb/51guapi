# 批量操作优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持批量审核和批量发布，添加批量操作进度跟踪，优化结果展示

**Architecture:** 使用 React Hook 管理批量操作状态，添加进度跟踪和批量操作功能

**Tech Stack:** React, TypeScript, CSS

---

### Task 1: 创建批量操作 Hook

**Covers:** [S5]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useBatchOperations.ts`
- Modify: `packages/extension/entrypoints/sidepanel/BatchView.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useBatchOperations.test.ts
import { renderHook, act } from '@testing-library/react';
import { useBatchOperations } from './useBatchOperations';

jest.mock('../../lib/messaging', () => ({
  approveBatch: jest.fn().mockResolvedValue({ ok: true }),
  discardBatchItem: jest.fn().mockResolvedValue({ ok: true }),
}));

describe('useBatchOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with empty state', () => {
    const { result } = renderHook(() => useBatchOperations());
    
    expect(result.current.selectedItems).toEqual([]);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it('selects items', () => {
    const { result } = renderHook(() => useBatchOperations());
    
    act(() => {
      result.current.selectItem('item-1');
    });
    
    expect(result.current.selectedItems).toContain('item-1');
    
    act(() => {
      result.current.selectItem('item-2');
    });
    
    expect(result.current.selectedItems).toContain('item-1');
    expect(result.current.selectedItems).toContain('item-2');
  });

  it('deselects items', () => {
    const { result } = renderHook(() => useBatchOperations());
    
    act(() => {
      result.current.selectItem('item-1');
      result.current.selectItem('item-2');
    });
    
    act(() => {
      result.current.deselectItem('item-1');
    });
    
    expect(result.current.selectedItems).not.toContain('item-1');
    expect(result.current.selectedItems).toContain('item-2');
  });

  it('selects all items', () => {
    const { result } = renderHook(() => useBatchOperations());
    
    act(() => {
      result.current.selectAll(['item-1', 'item-2', 'item-3']);
    });
    
    expect(result.current.selectedItems).toEqual(['item-1', 'item-2', 'item-3']);
  });

  it('clears selection', () => {
    const { result } = renderHook(() => useBatchOperations());
    
    act(() => {
      result.current.selectItem('item-1');
      result.current.selectItem('item-2');
    });
    
    act(() => {
      result.current.clearSelection();
    });
    
    expect(result.current.selectedItems).toEqual([]);
  });

  it('approves selected items', async () => {
    const { result } = renderHook(() => useBatchOperations());
    
    act(() => {
      result.current.selectItem('item-1');
      result.current.selectItem('item-2');
    });
    
    await act(async () => {
      await result.current.approveSelected();
    });
    
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.selectedItems).toEqual([]);
  });

  it('discards selected items', async () => {
    const { result } = renderHook(() => useBatchOperations());
    
    act(() => {
      result.current.selectItem('item-1');
    });
    
    await act(async () => {
      await result.current.discardSelected();
    });
    
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.selectedItems).toEqual([]);
  });

  it('tracks progress during operations', async () => {
    const { result } = renderHook(() => useBatchOperations());
    
    act(() => {
      result.current.selectItem('item-1');
      result.current.selectItem('item-2');
    });
    
    await act(async () => {
      await result.current.approveSelected();
    });
    
    expect(result.current.progress).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run hooks/useBatchOperations.test.ts`
Expected: FAIL with "Cannot find module './useBatchOperations'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/hooks/useBatchOperations.ts
import { useState, useCallback } from 'react';
import { approveBatch, discardBatchItem } from '../../lib/messaging';

interface UseBatchOperationsReturn {
  selectedItems: string[];
  isProcessing: boolean;
  progress: number;
  selectItem: (itemId: string) => void;
  deselectItem: (itemId: string) => void;
  selectAll: (itemIds: string[]) => void;
  clearSelection: () => void;
  approveSelected: () => Promise<void>;
  discardSelected: (reason?: string) => Promise<void>;
}

export function useBatchOperations(): UseBatchOperationsReturn {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const selectItem = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      if (prev.includes(itemId)) return prev;
      return [...prev, itemId];
    });
  }, []);

  const deselectItem = useCallback((itemId: string) => {
    setSelectedItems(prev => prev.filter(id => id !== itemId));
  }, []);

  const selectAll = useCallback((itemIds: string[]) => {
    setSelectedItems(itemIds);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItems([]);
  }, []);

  const approveSelected = useCallback(async () => {
    if (selectedItems.length === 0) return;
    
    setIsProcessing(true);
    setProgress(0);
    
    try {
      for (let i = 0; i < selectedItems.length; i++) {
        const itemId = selectedItems[i];
        await approveBatch(undefined, { [itemId]: true });
        setProgress(((i + 1) / selectedItems.length) * 100);
      }
      
      setSelectedItems([]);
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  }, [selectedItems]);

  const discardSelected = useCallback(async (reason?: string) => {
    if (selectedItems.length === 0) return;
    
    setIsProcessing(true);
    setProgress(0);
    
    try {
      for (let i = 0; i < selectedItems.length; i++) {
        const itemId = selectedItems[i];
        await discardBatchItem(itemId, reason);
        setProgress(((i + 1) / selectedItems.length) * 100);
      }
      
      setSelectedItems([]);
    } finally {
      setIsProcessing(false);
      setProgress(100);
    }
  }, [selectedItems]);

  return {
    selectedItems,
    isProcessing,
    progress,
    selectItem,
    deselectItem,
    selectAll,
    clearSelection,
    approveSelected,
    discardSelected,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run hooks/useBatchOperations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/hooks/useBatchOperations.ts packages/extension/entrypoints/sidepanel/hooks/useBatchOperations.test.ts
git commit -m "feat: add useBatchOperations hook"
```

### Task 2: 创建批量操作工具栏组件

**Covers:** [S5]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/components/BatchToolbar.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/BatchView.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/components/BatchToolbar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchToolbar } from './BatchToolbar';

describe('BatchToolbar', () => {
  it('renders with selection count', () => {
    render(
      <BatchToolbar
        selectedCount={3}
        totalCount={10}
        isProcessing={false}
        onSelectAll={jest.fn()}
        onClearSelection={jest.fn()}
        onApprove={jest.fn()}
        onDiscard={jest.fn()}
      />
    );
    
    expect(screen.getByText('已选择 3/10 项')).toBeInTheDocument();
  });

  it('shows select all button', () => {
    const onSelectAll = jest.fn();
    render(
      <BatchToolbar
        selectedCount={0}
        totalCount={10}
        isProcessing={false}
        onSelectAll={onSelectAll}
        onClearSelection={jest.fn()}
        onApprove={jest.fn()}
        onDiscard={jest.fn()}
      />
    );
    
    fireEvent.click(screen.getByText('全选'));
    expect(onSelectAll).toHaveBeenCalled();
  });

  it('shows clear selection button', () => {
    const onClearSelection = jest.fn();
    render(
      <BatchToolbar
        selectedCount={3}
        totalCount={10}
        isProcessing={false}
        onSelectAll={jest.fn()}
        onClearSelection={onClearSelection}
        onApprove={jest.fn()}
        onDiscard={jest.fn()}
      />
    );
    
    fireEvent.click(screen.getByText('取消选择'));
    expect(onClearSelection).toHaveBeenCalled();
  });

  it('shows approve button when items selected', () => {
    const onApprove = jest.fn();
    render(
      <BatchToolbar
        selectedCount={3}
        totalCount={10}
        isProcessing={false}
        onSelectAll={jest.fn()}
        onClearSelection={jest.fn()}
        onApprove={onApprove}
        onDiscard={jest.fn()}
      />
    );
    
    fireEvent.click(screen.getByText('批量批准'));
    expect(onApprove).toHaveBeenCalled();
  });

  it('disables buttons when processing', () => {
    render(
      <BatchToolbar
        selectedCount={3}
        totalCount={10}
        isProcessing={true}
        onSelectAll={jest.fn()}
        onClearSelection={jest.fn()}
        onApprove={jest.fn()}
        onDiscard={jest.fn()}
      />
    );
    
    expect(screen.getByText('全选')).toBeDisabled();
    expect(screen.getByText('批量批准')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run components/BatchToolbar.test.tsx`
Expected: FAIL with "Cannot find module './BatchToolbar'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/components/BatchToolbar.tsx
import React from 'react';
import { ProgressBar } from './ProgressBar';

interface BatchToolbarProps {
  selectedCount: number;
  totalCount: number;
  isProcessing: boolean;
  progress?: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onApprove: () => void;
  onDiscard: () => void;
}

export function BatchToolbar({
  selectedCount,
  totalCount,
  isProcessing,
  progress = 0,
  onSelectAll,
  onClearSelection,
  onApprove,
  onDiscard,
}: BatchToolbarProps) {
  return (
    <div
      style={{
        background: '#fafafa',
        border: '1px solid #d9d9d9',
        borderRadius: 6,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: '#666' }}>
          已选择 {selectedCount}/{totalCount} 项
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onSelectAll}
            disabled={isProcessing}
            style={{
              border: 'none',
              background: '#f0f0f0',
              color: '#333',
              padding: '4px 12px',
              borderRadius: 4,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              fontSize: 12,
            }}
          >
            全选
          </button>
          {selectedCount > 0 && (
            <button
              onClick={onClearSelection}
              disabled={isProcessing}
              style={{
                border: 'none',
                background: '#f0f0f0',
                color: '#333',
                padding: '4px 12px',
                borderRadius: 4,
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                fontSize: 12,
              }}
            >
              取消选择
            </button>
          )}
        </div>
      </div>
      
      {selectedCount > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onApprove}
            disabled={isProcessing}
            style={{
              border: 'none',
              background: '#1677ff',
              color: 'white',
              padding: '6px 16px',
              borderRadius: 4,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              fontSize: 13,
            }}
          >
            {isProcessing ? '处理中...' : '批量批准'}
          </button>
          <button
            onClick={onDiscard}
            disabled={isProcessing}
            style={{
              border: 'none',
              background: '#ff4d4f',
              color: 'white',
              padding: '6px 16px',
              borderRadius: 4,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              fontSize: 13,
            }}
          >
            {isProcessing ? '处理中...' : '批量否决'}
          </button>
        </div>
      )}
      
      {isProcessing && (
        <div style={{ marginTop: 8 }}>
          <ProgressBar progress={progress} label={`处理进度: ${Math.round(progress)}%`} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run components/BatchToolbar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/components/BatchToolbar.tsx packages/extension/entrypoints/sidepanel/components/BatchToolbar.test.tsx
git commit -m "feat: add BatchToolbar component"
```

### Task 3: 集成批量操作到 BatchView

**Covers:** [S5]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/BatchView.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/BatchView.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BatchView } from './BatchView';
import { useBatchOperations } from './hooks/useBatchOperations';

jest.mock('./hooks/useBatchOperations');
jest.mock('../../lib/messaging', () => ({
  getBatchState: jest.fn().mockResolvedValue({
    id: 'batch-1',
    items: [
      { id: 'item-1', topic: '选题1', status: 'awaiting-approval' },
      { id: 'item-2', topic: '选题2', status: 'awaiting-approval' },
    ],
  }),
  getSafetyMode: jest.fn().mockResolvedValue('off'),
  getPendingQuarantineAlert: jest.fn().mockResolvedValue(0),
  runBatch: jest.fn(),
  approveBatch: jest.fn(),
  discardBatchItem: jest.fn(),
}));

describe('BatchView with batch operations', () => {
  beforeEach(() => {
    const mockBatchOperations = useBatchOperations as jest.Mock;
    mockBatchOperations.mockReturnValue({
      selectedItems: [],
      isProcessing: false,
      progress: 0,
      selectItem: jest.fn(),
      deselectItem: jest.fn(),
      selectAll: jest.fn(),
      clearSelection: jest.fn(),
      approveSelected: jest.fn(),
      discardSelected: jest.fn(),
    });
  });

  it('shows batch toolbar when items available', async () => {
    render(<BatchView onBack={jest.fn()} />);
    
    await waitFor(() => {
      expect(screen.getByText('已选择 0/2 项')).toBeInTheDocument();
    });
  });

  it('selects items when clicked', async () => {
    const mockSelectItem = jest.fn();
    const mockBatchOperations = useBatchOperations as jest.Mock;
    mockBatchOperations.mockReturnValue({
      selectedItems: ['item-1'],
      isProcessing: false,
      progress: 0,
      selectItem: mockSelectItem,
      deselectItem: jest.fn(),
      selectAll: jest.fn(),
      clearSelection: jest.fn(),
      approveSelected: jest.fn(),
      discardSelected: jest.fn(),
    });
    
    render(<BatchView onBack={jest.fn()} />);
    
    await waitFor(() => {
      expect(screen.getByText('已选择 1/2 项')).toBeInTheDocument();
    });
  });

  it('calls approveSelected when approve button clicked', async () => {
    const mockApproveSelected = jest.fn();
    const mockBatchOperations = useBatchOperations as jest.Mock;
    mockBatchOperations.mockReturnValue({
      selectedItems: ['item-1', 'item-2'],
      isProcessing: false,
      progress: 0,
      selectItem: jest.fn(),
      deselectItem: jest.fn(),
      selectAll: jest.fn(),
      clearSelection: jest.fn(),
      approveSelected: mockApproveSelected,
      discardSelected: jest.fn(),
    });
    
    render(<BatchView onBack={jest.fn()} />);
    
    await waitFor(() => {
      fireEvent.click(screen.getByText('批量批准'));
    });
    
    expect(mockApproveSelected).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run BatchView.test.tsx`
Expected: FAIL with "useBatchOperations is not a function"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/BatchView.tsx
// 在文件顶部添加导入
import { useBatchOperations } from './hooks/useBatchOperations';
import { BatchToolbar } from './components/BatchToolbar';

// 在 BatchView 组件内部添加 hook 调用
export function BatchView({ onBack }: { onBack: () => void }) {
  // ... 现有状态
  const {
    selectedItems,
    isProcessing,
    progress,
    selectItem,
    deselectItem,
    selectAll,
    clearSelection,
    approveSelected,
    discardSelected,
  } = useBatchOperations();

  // 获取可选择的项
  const selectableItems = batch?.items.filter(item => 
    item.status === 'awaiting-approval'
  ) || [];

  // 修改 onApprove 函数
  async function handleApprove() {
    if (selectedItems.length === 0) {
      // 原有逻辑：逐条批准
      await withBusy(async () => {
        const report = await checkSelectors(batch.tabId);
        setDrift(report);
        if (!report.ok) {
          setError(
            `选择器自检失败,缺失:${report.missing.join("、")}。请点"漂移自检"了解详情,或在目标页修复后重试。`,
          );
          return;
        }
        const overrides =
          draftOverrides.size > 0
            ? Object.fromEntries(draftOverrides)
            : undefined;
        await approveBatch(batch.tabId, overrides);
        setDraftOverrides(new Map());
        await refresh();
      });
    } else {
      // 批量批准
      await withBusy(async () => {
        await approveSelected();
        await refresh();
      });
    }
  }

  // 在 JSX 中添加批量操作工具栏
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12, fontSize: 14 }}>
      {/* ... 现有 JSX */}
      
      {view === 'batch' && batch && batchPhase(batch) !== 'empty' && (
        <>
          {/* 批量操作工具栏 */}
          {selectableItems.length > 0 && (
            <BatchToolbar
              selectedCount={selectedItems.length}
              totalCount={selectableItems.length}
              isProcessing={isProcessing}
              progress={progress}
              onSelectAll={() => selectAll(selectableItems.map(item => item.id))}
              onClearSelection={clearSelection}
              onApprove={handleApprove}
              onDiscard={discardSelected}
            />
          )}
          
          {/* 现有的 BatchReviewPanel */}
          <BatchReviewPanel
            batch={batch}
            draftOverrides={draftOverrides}
            safetyMode={safetyMode}
            authorizedHost={batch.authorizedHost}
            tabHealthy={tabHealthy}
            busy={busy}
            driftResult={drift}
            readItems={readItems}
            onItemRead={onItemRead}
            onDiscardItem={onDiscardItem}
            allRead={allRead}
            onApprove={handleApprove}
            onApproveBypass={() =>
              void withBusy(async () => {
                const overrides =
                  draftOverrides.size > 0
                    ? Object.fromEntries(draftOverrides)
                    : undefined;
                await approveBatch(batch.tabId, overrides);
                setDraftOverrides(new Map());
                await refresh();
              })
            }
            onDraftChange={(itemId, draft) =>
              setDraftOverrides((prev) => new Map(prev).set(itemId, draft))
            }
            onKill={() =>
              void withBusy(async () => {
                await killBatch();
                setDraftOverrides(new Map());
                await refresh();
              })
            }
            onRelease={(itemId) =>
              void withBusy(async () => {
                await releaseQuarantine(itemId);
                await refresh();
              })
            }
            onRetryItem={(itemId) =>
              void withBusy(async () => {
                await retryBatchItemMsg(itemId);
                await refresh();
              })
            }
            onDriftCheck={() =>
              void withBusy(async () => {
                setDrift(await checkSelectors(batch.tabId));
              })
            }
            onResume={() => void refresh()}
            onItemEdited={(itemId) => {
              void (async () => {
                await markItemEdited(itemId);
                await refresh();
              })();
            }}
            onSaveAsFewShot={(itemId) => {
              void handleSaveAsFewShot(itemId);
            }}
            selectedItems={selectedItems}
            onSelectItem={(itemId) => {
              if (selectedItems.includes(itemId)) {
                deselectItem(itemId);
              } else {
                selectItem(itemId);
              }
            }}
          />
        </>
      )}
      
      {/* ... 其余 JSX */}
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run BatchView.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/BatchView.tsx
git commit -m "feat: integrate batch operations into BatchView"
```

### Task 4: 添加批量操作进度显示

**Covers:** [S5]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/components/BatchToolbar.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/components/BatchToolbar.test.tsx
import { render, screen } from '@testing-library/react';
import { BatchToolbar } from './BatchToolbar';

describe('BatchToolbar progress', () => {
  it('shows progress during processing', () => {
    render(
      <BatchToolbar
        selectedCount={3}
        totalCount={10}
        isProcessing={true}
        progress={50}
        onSelectAll={jest.fn()}
        onClearSelection={jest.fn()}
        onApprove={jest.fn()}
        onDiscard={jest.fn()}
      />
    );
    
    expect(screen.getByText('处理进度: 50%')).toBeInTheDocument();
  });

  it('shows 100% progress when complete', () => {
    render(
      <BatchToolbar
        selectedCount={3}
        totalCount={10}
        isProcessing={false}
        progress={100}
        onSelectAll={jest.fn()}
        onClearSelection={jest.fn()}
        onApprove={jest.fn()}
        onDiscard={jest.fn()}
      />
    );
    
    expect(screen.getByText('处理进度: 100%')).toBeInTheDocument();
  });

  it('hides progress when not processing and progress is 0', () => {
    render(
      <BatchToolbar
        selectedCount={3}
        totalCount={10}
        isProcessing={false}
        progress={0}
        onSelectAll={jest.fn()}
        onClearSelection={jest.fn()}
        onApprove={jest.fn()}
        onDiscard={jest.fn()}
      />
    );
    
    expect(screen.queryByText('处理进度')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run components/BatchToolbar.test.tsx`
Expected: FAIL with "处理进度" not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/components/BatchToolbar.tsx
// 修改 BatchToolbar 组件
export function BatchToolbar({
  selectedCount,
  totalCount,
  isProcessing,
  progress = 0,
  onSelectAll,
  onClearSelection,
  onApprove,
  onDiscard,
}: BatchToolbarProps) {
  // 计算是否显示进度
  const showProgress = isProcessing || progress > 0;
  
  return (
    <div
      style={{
        background: '#fafafa',
        border: '1px solid #d9d9d9',
        borderRadius: 6,
        padding: 12,
        marginBottom: 12,
      }}
    >
      {/* ... 现有 JSX */}
      
      {showProgress && (
        <div style={{ marginTop: 8 }}>
          <ProgressBar progress={progress} label={`处理进度: ${Math.round(progress)}%`} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run components/BatchToolbar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/components/BatchToolbar.tsx
git commit -m "feat: add progress display to BatchToolbar"
```

### Task 5: 添加批量操作结果展示

**Covers:** [S5]

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/components/BatchResultSummary.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/BatchView.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/components/BatchResultSummary.test.tsx
import { render, screen } from '@testing-library/react';
import { BatchResultSummary } from './BatchResultSummary';

describe('BatchResultSummary', () => {
  it('renders success count', () => {
    const results = [
      { id: '1', success: true },
      { id: '2', success: true },
      { id: '3', success: false },
    ];
    
    render(<BatchResultSummary results={results} />);
    
    expect(screen.getByText('成功: 2')).toBeInTheDocument();
  });

  it('renders failure count', () => {
    const results = [
      { id: '1', success: true },
      { id: '2', success: false },
      { id: '3', success: false },
    ];
    
    render(<BatchResultSummary results={results} />);
    
    expect(screen.getByText('失败: 2')).toBeInTheDocument();
  });

  it('renders total count', () => {
    const results = [
      { id: '1', success: true },
      { id: '2', success: false },
      { id: '3', success: true },
    ];
    
    render(<BatchResultSummary results={results} />);
    
    expect(screen.getByText('总计: 3')).toBeInTheDocument();
  });

  it('shows success rate', () => {
    const results = [
      { id: '1', success: true },
      { id: '2', success: true },
      { id: '3', success: true },
      { id: '4', success: false },
    ];
    
    render(<BatchResultSummary results={results} />);
    
    expect(screen.getByText('成功率: 75%')).toBeInTheDocument();
  });

  it('shows empty state', () => {
    render(<BatchResultSummary results={[]} />);
    
    expect(screen.getByText('暂无操作结果')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run components/BatchResultSummary.test.tsx`
Expected: FAIL with "Cannot find module './BatchResultSummary'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/components/BatchResultSummary.tsx
import React from 'react';

interface BatchResult {
  id: string;
  success: boolean;
  error?: string;
}

interface BatchResultSummaryProps {
  results: BatchResult[];
}

export function BatchResultSummary({ results }: BatchResultSummaryProps) {
  if (results.length === 0) {
    return (
      <div
        style={{
          background: '#fafafa',
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          padding: 12,
          marginBottom: 12,
          textAlign: 'center',
          color: '#8c8c8c',
        }}
      >
        暂无操作结果
      </div>
    );
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;
  const totalCount = results.length;
  const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

  return (
    <div
      style={{
        background: '#fafafa',
        border: '1px solid #d9d9d9',
        borderRadius: 6,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>操作结果汇总</div>
      
      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#389e0d' }}>●</span>
          <span>成功: {successCount}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#cf1322' }}>●</span>
          <span>失败: {failureCount}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#1677ff' }}>●</span>
          <span>总计: {totalCount}</span>
        </div>
      </div>
      
      <div style={{ fontSize: 12, color: '#666' }}>
        成功率: {successRate}%
      </div>
      
      {failureCount > 0 && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>失败详情:</div>
          {results.filter(r => !r.success).map(r => (
            <div key={r.id} style={{ color: '#cf1322', marginBottom: 2 }}>
              • {r.error || '未知错误'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run components/BatchResultSummary.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/components/BatchResultSummary.tsx packages/extension/entrypoints/sidepanel/components/BatchResultSummary.test.tsx
git commit -m "feat: add BatchResultSummary component"
```

### Task 6: 集成批量操作结果到 BatchView

**Covers:** [S5]

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/BatchView.tsx:1`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/extension/entrypoints/sidepanel/BatchView.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { BatchView } from './BatchView';
import { useBatchOperations } from './hooks/useBatchOperations';

jest.mock('./hooks/useBatchOperations');
jest.mock('../../lib/messaging', () => ({
  getBatchState: jest.fn().mockResolvedValue({
    id: 'batch-1',
    items: [
      { id: 'item-1', topic: '选题1', status: 'confirmed' },
      { id: 'item-2', topic: '选题2', status: 'error' },
    ],
  }),
  getSafetyMode: jest.fn().mockResolvedValue('off'),
  getPendingQuarantineAlert: jest.fn().mockResolvedValue(0),
}));

describe('BatchView with result summary', () => {
  beforeEach(() => {
    const mockBatchOperations = useBatchOperations as jest.Mock;
    mockBatchOperations.mockReturnValue({
      selectedItems: [],
      isProcessing: false,
      progress: 0,
      selectItem: jest.fn(),
      deselectItem: jest.fn(),
      selectAll: jest.fn(),
      clearSelection: jest.fn(),
      approveSelected: jest.fn(),
      discardSelected: jest.fn(),
    });
  });

  it('shows result summary when batch is complete', async () => {
    render(<BatchView onBack={jest.fn()} />);
    
    await waitFor(() => {
      expect(screen.getByText('操作结果汇总')).toBeInTheDocument();
    });
  });

  it('shows success and failure counts', async () => {
    render(<BatchView onBack={jest.fn()} />);
    
    await waitFor(() => {
      expect(screen.getByText('成功: 1')).toBeInTheDocument();
      expect(screen.getByText('失败: 1')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/extension && npx vitest run BatchView.test.tsx`
Expected: FAIL with "操作结果汇总" not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/extension/entrypoints/sidepanel/BatchView.tsx
// 在文件顶部添加导入
import { BatchResultSummary } from './components/BatchResultSummary';

// 在 BatchView 组件内部添加结果状态
export function BatchView({ onBack }: { onBack: () => void }) {
  // ... 现有状态
  const [operationResults, setOperationResults] = useState<Array<{ id: string; success: boolean; error?: string }>>([]);

  // 修改 handleApprove 函数
  async function handleApprove() {
    if (selectedItems.length === 0) {
      // 原有逻辑
      await withBusy(async () => {
        const report = await checkSelectors(batch.tabId);
        setDrift(report);
        if (!report.ok) {
          setError(
            `选择器自检失败,缺失:${report.missing.join("、")}。请点"漂移自检"了解详情,或在目标页修复后重试。`,
          );
          return;
        }
        const overrides =
          draftOverrides.size > 0
            ? Object.fromEntries(draftOverrides)
            : undefined;
        await approveBatch(batch.tabId, overrides);
        setDraftOverrides(new Map());
        await refresh();
      });
    } else {
      // 批量批准
      await withBusy(async () => {
        const results: Array<{ id: string; success: boolean; error?: string }> = [];
        
        for (const itemId of selectedItems) {
          try {
            await approveBatch(undefined, { [itemId]: true });
            results.push({ id: itemId, success: true });
          } catch (error) {
            results.push({
              id: itemId,
              success: false,
              error: error instanceof Error ? error.message : '未知错误',
            });
          }
        }
        
        setOperationResults(results);
        clearSelection();
        await refresh();
      });
    }
  }

  // 在 JSX 中添加结果汇总
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 12, fontSize: 14 }}>
      {/* ... 现有 JSX */}
      
      {view === 'batch' && batch && batchPhase(batch) !== 'empty' && (
        <>
          {/* 批量操作结果汇总 */}
          {operationResults.length > 0 && (
            <BatchResultSummary results={operationResults} />
          )}
          
          {/* 现有的 BatchToolbar 和 BatchReviewPanel */}
          {/* ... */}
        </>
      )}
      
      {/* ... 其余 JSX */}
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/extension && npx vitest run BatchView.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/entrypoints/sidepanel/BatchView.tsx
git commit -m "feat: integrate batch result summary into BatchView"
```