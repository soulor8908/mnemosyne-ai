// 笔记编辑器：分栏 markdown 编辑 + 预览
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { updateNote, getNote, deleteNote } from '@/lib/db/notes';
import { embedNote } from '@/lib/ai/embed';
import { debounce } from '@/lib/utils';
import type { Note } from '@/types';

export default function NoteEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const noteId = params.id;

  const [note, setNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [showPreview, setShowPreview] = useState(true);
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
        // 延迟生成嵌入（content 变化后 3 秒）
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
      <div className="flex items-center justify-between border-b border-ink-200 bg-white px-6 py-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="无标题"
          className="flex-1 bg-transparent text-lg font-medium text-ink-900 placeholder-ink-300 focus:outline-none"
        />
        <div className="ml-4 flex items-center gap-3">
          <span className="text-xs text-ink-400">
            {saving ? '保存中…' : savedAt ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN')}` : ''}
          </span>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="rounded-md border border-ink-200 px-3 py-1 text-xs text-ink-600 hover:bg-ink-50"
          >
            {showPreview ? '隐藏预览' : '显示预览'}
          </button>
          <button
            onClick={handleDelete}
            className="rounded-md border border-ink-200 px-3 py-1 text-xs text-red-500 hover:bg-red-50"
          >
            删除
          </button>
        </div>
      </div>

      {/* 编辑区 */}
      <div className="flex flex-1 overflow-hidden">
        <div className={`flex ${showPreview ? 'w-1/2' : 'w-full'} flex-col`}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="开始写作…（支持 Markdown）"
            className="editor-textarea flex-1 resize-none bg-white px-6 py-4 font-mono text-sm leading-7 text-ink-800 placeholder-ink-300 focus:outline-none"
            spellCheck={false}
          />
        </div>
        {showPreview && (
          <div className="w-1/2 overflow-y-auto border-l border-ink-200 bg-ink-50 px-6 py-4">
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || '*预览区为空*'}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
