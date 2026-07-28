// 可左滑露出操作按钮的笔记列表项（移动端手势 + 桌面端兼容）
'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import type { Note } from '@/types';

interface SwipeableNoteItemProps {
  note: Note;
  selectMode: boolean;
  isSelected: boolean;
  isDragging: boolean;
  onToggleSelect: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onPreview: (id: string) => void;
  onLongPress: (id: string) => void;
  onLongPressEnd: () => void;
  dragHandlers?: {
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
  };
}

const ACTION_WIDTH = 200; // 三个按钮的总宽度
const LONG_PRESS_MS = 500; // 长按阈值
const SWIPE_THRESHOLD = ACTION_WIDTH / 2; // 超过此距离视为完全展开

export function SwipeableNoteItem({
  note,
  selectMode,
  isSelected,
  isDragging,
  onToggleSelect,
  onPin,
  onDelete,
  onPreview,
  onLongPress,
  onLongPressEnd,
  dragHandlers,
}: SwipeableNoteItemProps) {
  const [offset, setOffset] = useState(0); // 当前左滑偏移（负数）
  const [animating, setAnimating] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const startOffset = useRef(0);
  const dragging = useRef(false);
  const decided = useRef(false); // 是否已判定为水平滑动
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  // 动画结束后清除 animating
  const handleTransitionEnd = useCallback(() => {
    setAnimating(false);
  }, []);

  // 复位
  const close = useCallback(() => {
    setAnimating(true);
    setOffset(0);
  }, []);

  // 点击操作后复位
  useEffect(() => {
    if (offset === 0) return;
    // 当 selectMode 开启时自动关闭
    if (selectMode) close();
  }, [selectMode, offset, close]);

  // ============ 触摸事件（移动端左滑 + 长按） ============
  function onTouchStart(e: React.TouchEvent) {
    if (selectMode) return;
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    startOffset.current = offset;
    dragging.current = true;
    decided.current = false;
    longPressed.current = false;
    setAnimating(false);

    // 长按检测（仅在偏移为 0 即未展开操作时触发）
    if (offset === 0) {
      longPressTimer.current = setTimeout(() => {
        longPressed.current = true;
        onLongPress(note.id);
      }, LONG_PRESS_MS);
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!dragging.current || selectMode) return;
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;

    // 判定滑动方向（仅一次）
    if (!decided.current) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      decided.current = true;
      // 垂直滑动：取消长按，不阻止滚动
      if (Math.abs(dy) > Math.abs(dx)) {
        dragging.current = false;
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        return;
      }
      // 水平滑动：取消长按，阻止滚动
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    }

    if (!dragging.current) return;
    e.preventDefault?.();

    // 仅允许左滑（dx < 0）或从展开状态右滑回 0
    let next = startOffset.current + dx;
    if (next > 0) next = 0;
    if (next < -ACTION_WIDTH) {
      // 阻尼
      next = -ACTION_WIDTH - (next + ACTION_WIDTH) * 0.3;
    }
    setOffset(next);
  }

  function onTouchEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (longPressed.current) {
      onLongPressEnd();
      return;
    }
    if (!dragging.current) return;
    dragging.current = false;
    setAnimating(true);
    // 超过阈值展开，否则收回
    setOffset(offset < -SWIPE_THRESHOLD ? -ACTION_WIDTH : 0);
  }

  // ============ 操作按钮 ============
  function handlePin(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onPin(note.id, !note.pinned);
    close();
  }

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onDelete(note.id);
    close();
  }

  function handlePreview(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onPreview(note.id);
    close();
  }

  const isSel = isSelected;
  const showActions = !selectMode;

  return (
    <div
      className={`relative overflow-hidden rounded-lg border bg-white transition-shadow ${
        isSel ? 'border-accent bg-accent/5' : 'border-ink-200 hover:border-accent'
      } ${isDragging ? 'opacity-50 shadow-lg ring-2 ring-accent' : ''} ${
        note.pinned ? 'border-l-4 border-l-yellow-400' : ''
      }`}
      onTransitionEnd={handleTransitionEnd}
    >
      {/* 操作按钮层（在底层，露出时可见） */}
      {showActions && (
        <div
          className="absolute inset-y-0 right-0 flex items-stretch"
          style={{ width: ACTION_WIDTH }}
        >
          <button
            onClick={handlePreview}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-ink-600 text-white hover:bg-ink-700"
            aria-label="预览编辑"
          >
            <Icon name="edit" size={18} />
            <span className="text-[10px]">编辑</span>
          </button>
          <button
            onClick={handlePin}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-white hover:opacity-90 ${
              note.pinned ? 'bg-yellow-500' : 'bg-yellow-600'
            }`}
            aria-label={note.pinned ? '取消置顶' : '置顶'}
          >
            <Icon name={note.pinned ? 'pin-off' : 'pin'} size={18} />
            <span className="text-[10px]">{note.pinned ? '取消' : '置顶'}</span>
          </button>
          <button
            onClick={handleDelete}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-red-500 text-white hover:bg-red-600"
            aria-label="删除"
          >
            <Icon name="trash" size={18} />
            <span className="text-[10px]">删除</span>
          </button>
        </div>
      )}

      {/* 内容层（可滑动） */}
      <div
        className={`relative bg-white ${animating ? 'transition-transform duration-200' : ''}`}
        style={{
          transform: `translateX(${offset}px)`,
          touchAction: selectMode ? 'auto' : 'pan-y',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        draggable={!selectMode && !!dragHandlers}
        onDragStart={dragHandlers?.onDragStart}
        onDragOver={dragHandlers?.onDragOver}
        onDrop={dragHandlers?.onDrop}
        onDragEnd={dragHandlers?.onDragEnd}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          {selectMode && (
            <input
              type="checkbox"
              checked={isSel}
              onChange={() => onToggleSelect(note.id)}
              className="mt-1 h-4 w-4 shrink-0 accent-accent"
            />
          )}
          {/* 拖动手柄（拖动模式下显示） */}
          {!selectMode && (
            <span
              className="mt-1 hidden shrink-0 cursor-grab text-ink-300 hover:text-ink-500 active:cursor-grabbing sm:block"
              title="拖动排序"
            >
              <Icon name="grip" size={16} />
            </span>
          )}
          <Link
            href={`/notes/${note.id}`}
            className="min-w-0 flex-1"
            onClick={(e) => {
              if (selectMode) {
                e.preventDefault();
                onToggleSelect(note.id);
                return;
              }
              // 如果左滑已展开，点击内容区收回而非跳转
              if (offset < -SWIPE_THRESHOLD) {
                e.preventDefault();
                close();
              }
            }}
          >
            <div className="flex items-center gap-1.5">
              {note.pinned && (
                <Icon name="pin" size={13} className="shrink-0 text-yellow-500" />
              )}
              <span className="font-medium text-ink-900">{note.title || '无标题'}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-sm text-ink-400 sm:line-clamp-1 sm:truncate">
              {note.content.slice(0, 120) || '（空）'}
            </div>
            {note.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {note.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </Link>
          <div className="ml-2 shrink-0 text-xs text-ink-400">
            {new Date(note.updatedAt).toLocaleDateString('zh-CN')}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SwipeableNoteItem;
