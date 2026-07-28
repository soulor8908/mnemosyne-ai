// 笔记列表页：搜索、多选、左滑操作、长按拖动排序、置顶
'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  listNotes,
  createNote,
  searchNotesByKeyword,
  bulkDeleteNotes,
  togglePinned,
  reorderNotes,
} from '@/lib/db/notes';
import { exportSelectedAsJson, exportSelectedAsMarkdown } from '@/lib/markdown/export';
import { Icon } from '@/components/ui/icon';
import { SwipeableNoteItem } from '@/components/notes/swipeable-note-item';
import type { Note } from '@/types';

export default function NotesPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  // 拖动排序状态
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const all = await listNotes({ limit: 200 });
    setNotes(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      load();
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchNotesByKeyword(query, 100);
      setNotes(results);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, load]);

  useEffect(() => {
    setSelected(new Set());
    setSelectMode(false);
  }, [query]);

  async function handleNew() {
    const note = await createNote({ content: '' });
    router.push(`/notes/${note.id}`);
  }

  const allSelected = useMemo(
    () => notes.length > 0 && selected.size === notes.length,
    [notes, selected]
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(notes.map((n) => n.id)));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // ============ 操作（左滑按钮） ============
  async function handlePin(id: string, pinned: boolean) {
    try {
      await togglePinned(id, pinned);
      showToast(pinned ? '已置顶' : '已取消置顶');
      await load();
    } catch (err) {
      showToast('操作失败：' + (err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确认删除此笔记？此操作不可撤销。')) return;
    setBusy(true);
    try {
      await bulkDeleteNotes([id]);
      showToast('已删除');
      await load();
    } catch (err) {
      showToast('删除失败：' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handlePreview(id: string) {
    router.push(`/notes/${id}`);
  }

  // ============ 批量操作 ============
  async function handleExportSelected(format: 'json' | 'md') {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const ids = Array.from(selected);
      const blob =
        format === 'json'
          ? await exportSelectedAsJson(ids)
          : await exportSelectedAsMarkdown(ids);
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadBlob(blob, `mnemosyne-${format}-${ts}.${format === 'json' ? 'json' : 'md'}`);
      showToast(`已导出 ${ids.length} 篇笔记`);
    } catch (err) {
      showToast('导出失败：' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`确认删除选中的 ${selected.size} 篇笔记？此操作不可撤销。`)) return;
    setBusy(true);
    try {
      await bulkDeleteNotes(Array.from(selected));
      showToast(`已删除 ${selected.size} 篇笔记`);
      exitSelectMode();
      await load();
    } catch (err) {
      showToast('删除失败：' + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ============ 拖动排序 ============
  // 长按触发：标记该笔记为可拖动
  function handleLongPress(id: string) {
    if (selectMode || query.trim()) return;
    setDraggingId(id);
    showToast('已进入拖动模式，拖到目标位置释放');
  }

  function handleLongPressEnd() {
    // 拖动结束在 onDragEnd 处理
  }

  // HTML5 drag and drop（桌面 + 长按后的移动端）
  function getDragHandlers(noteId: string) {
    if (!draggingId) return undefined;
    return {
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', noteId);
        setDraggingId(noteId);
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverId !== noteId) setDragOverId(noteId);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const srcId = e.dataTransfer.getData('text/plain') || draggingId;
        if (!srcId || srcId === noteId) return;
        handleReorder(srcId, noteId);
      },
      onDragEnd: () => {
        setDraggingId(null);
        setDragOverId(null);
      },
    };
  }

  async function handleReorder(srcId: string, dstId: string) {
    const ids = notes.map((n) => n.id);
    const srcIdx = ids.indexOf(srcId);
    const dstIdx = ids.indexOf(dstId);
    if (srcIdx === -1 || dstIdx === -1 || srcIdx === dstIdx) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    // 乐观更新 UI
    const next = [...notes];
    const [moved] = next.splice(srcIdx, 1);
    next.splice(dstIdx, 0, moved);
    setNotes(next);
    setDraggingId(null);
    setDragOverId(null);
    // 持久化
    try {
      await reorderNotes(next.map((n) => n.id));
    } catch (err) {
      showToast('排序保存失败：' + (err as Error).message);
      await load();
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {/* 顶部标题栏 */}
      <div className="mb-5 flex items-center justify-between gap-2 sm:mb-6">
        <h1 className="text-xl font-semibold text-ink-900 sm:text-2xl">笔记</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectMode((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors ${
              selectMode
                ? 'border-accent bg-accent text-white hover:bg-accent-hover'
                : 'border-ink-200 text-ink-600 hover:bg-ink-50'
            }`}
            aria-label="选择"
          >
            <Icon name={selectMode ? 'check' : 'list'} size={16} />
            <span className="hidden sm:inline">{selectMode ? '完成' : '选择'}</span>
          </button>
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm text-white hover:bg-accent-hover sm:px-4"
          >
            <Icon name="plus" size={16} />
            <span className="hidden sm:inline">新建</span>
          </button>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="relative mb-4">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
          <Icon name="search" size={16} />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索笔记…"
          className="w-full rounded-lg border border-ink-200 bg-white py-2 pl-9 pr-4 text-sm placeholder-ink-400 focus:border-accent focus:outline-none"
        />
      </div>

      {/* 提示：长按拖动 */}
      {!selectMode && !query.trim() && notes.length > 1 && (
        <p className="mb-3 flex items-center gap-1 text-xs text-ink-400">
          <Icon name="grip" size={12} />
          提示：长按笔记可拖动排序，左滑露出操作
        </p>
      )}

      {/* 选择模式下的批量操作工具栏 */}
      {selectMode && (
        <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-white px-3 py-2 shadow-sm">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 accent-accent"
            />
            全选
          </label>
          <span className="text-xs text-ink-400">
            已选 {selected.size} / {notes.length}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => handleExportSelected('json')}
            disabled={selected.size === 0 || busy}
            className="flex items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-40"
          >
            <Icon name="json" size={14} />
            导出 JSON
          </button>
          <button
            onClick={() => handleExportSelected('md')}
            disabled={selected.size === 0 || busy}
            className="flex items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-40"
          >
            <Icon name="markdown" size={14} />
            导出 MD
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={selected.size === 0 || busy}
            className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
          >
            <Icon name="trash" size={14} />
            删除
          </button>
          <button
            onClick={exitSelectMode}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-400 hover:bg-ink-50"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <p className="text-sm text-ink-400">加载中…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-ink-400">
          {query ? '没有匹配的笔记' : '还没有笔记，点击「新建」开始'}
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <SwipeableNoteItem
              key={note.id}
              note={note}
              selectMode={selectMode}
              isSelected={selected.has(note.id)}
              isDragging={draggingId === note.id}
              onToggleSelect={toggleSelect}
              onPin={handlePin}
              onDelete={handleDelete}
              onPreview={handlePreview}
              onLongPress={handleLongPress}
              onLongPressEnd={handleLongPressEnd}
              dragHandlers={getDragHandlers(note.id)}
            />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
