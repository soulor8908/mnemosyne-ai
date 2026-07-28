// 笔记编辑器：分栏 markdown 编辑 + 预览（移动端 tab 切换）
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { updateNote, getNote, deleteNote } from '@/lib/db/notes';
import { embedNote } from '@/lib/ai/embed';
import { debounce } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import type { Note } from '@/types';

type MobileView = 'edit' | 'preview';

export default function NoteEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const noteId = params.id;

  const [note, setNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  // 桌面端：是否显示预览栏；移动端：当前 tab
  const [showPreview, setShowPreview] = useState(true);
  const [mobileView, setMobileView] = useState<MobileView>('edit');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const embedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载
  useEffect(() => {
    if (!noteId) return;
    getNote(noteId).then((n) => {
      if (n) {
        setNote(n);
        setContent(n.content);
        setTitle(n.title);
      }
    });
  }, [noteId]);

  // 防抖保存
  const debouncedSave = useCallback(
    debounce(async (id: string, newTitle: string, newContent: string) => {
      setSaving(true);
      try {
        await updateNote(id, { title: newTitle, content: newContent });
        setSavedAt(Date.now());
        if (embedTimerRef.current) clearTimeout(embedTimerRef.current);
        embedTimerRef.current = setTimeout(() => {
          embedNote(id, newContent).catch((e) => console.error('embed failed', e));
        }, 3000);
      } finally {
        setSaving(false);
      }
    }, 800),
    []
  );

  useEffect(() => {
    if (!note) return;
    debouncedSave(note.id, title, content);
  }, [title, content, note, debouncedSave]);

  async function handleDelete() {
    if (!note) return;
    if (!confirm('确认删除？此操作不可撤销。')) return;
    await deleteNote(note.id);
    router.push('/notes');
  }

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-ink-400">加载中…</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex items-center justify-between gap-2 border-b border-ink-200 bg-white px-4 py-3 sm:px-6">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="无标题"
          className="min-w-0 flex-1 bg-transparent text-base font-medium text-ink-900 placeholder-ink-300 focus:outline-none sm:text-lg"
        />
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden text-xs text-ink-400 xs:inline sm:inline">
            {saving ? '保存中…' : savedAt ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN')}` : ''}
          </span>
          {/* 桌面端：显示/隐藏预览 */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="hidden items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50 lg:flex"
          >
            <Icon name={showPreview ? 'eye-off' : 'eye'} size={14} />
            {showPreview ? '隐藏预览' : '显示预览'}
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50"
          >
            <Icon name="trash" size={14} />
            <span className="hidden sm:inline">删除</span>
          </button>
        </div>
      </div>

      {/* 移动端 tab 切换 */}
      <div className="flex border-b border-ink-200 bg-white lg:hidden">
        <button
          onClick={() => setMobileView('edit')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-sm ${
            mobileView === 'edit'
              ? 'border-b-2 border-accent font-medium text-accent'
              : 'text-ink-500'
          }`}
        >
          <Icon name="edit" size={16} />
          编辑
        </button>
        <button
          onClick={() => setMobileView('preview')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-sm ${
            mobileView === 'preview'
              ? 'border-b-2 border-accent font-medium text-accent'
              : 'text-ink-500'
          }`}
        >
          <Icon name="eye" size={16} />
          预览
        </button>
      </div>

      {/* 编辑区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 编辑器：桌面端按 showPreview 决定宽度，移动端按 tab 决定显示 */}
        <div
          className={`flex flex-col ${
            showPreview ? 'lg:w-1/2 lg:flex' : 'lg:w-full lg:flex'
          } ${mobileView === 'edit' ? 'flex w-full' : 'hidden lg:flex'}`}
        >
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="开始写作…（支持 Markdown）"
            className="editor-textarea flex-1 resize-none bg-white px-4 py-4 font-mono text-sm leading-7 text-ink-800 placeholder-ink-300 focus:outline-none sm:px-6"
            spellCheck={false}
          />
        </div>
        {/* 预览：桌面端按 showPreview 决定，移动端按 tab 决定 */}
        <div
          className={`overflow-y-auto border-l border-ink-200 bg-ink-50 px-4 py-4 sm:px-6 ${
            showPreview ? 'lg:w-1/2 lg:block' : 'lg:hidden'
          } ${mobileView === 'preview' ? 'block w-full' : 'hidden lg:block'}`}
        >
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || '*预览区为空*'}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
