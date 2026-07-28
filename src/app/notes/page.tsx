// 笔记列表页
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listNotes, createNote, searchNotesByKeyword } from '@/lib/db/notes';
import type { Note } from '@/types';

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const all = await listNotes({ limit: 200 });
    setNotes(all);
    setLoading(false);
  }

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
  }, [query]);

  async function handleNew() {
    const note = await createNote({ content: '' });
    window.location.href = `/notes/${note.id}`;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink-900">笔记</h1>
        <button
          onClick={handleNew}
          className="rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
        >
          + 新建
        </button>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索笔记…"
        className="mb-4 w-full rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm placeholder-ink-400 focus:border-accent focus:outline-none"
      />

      {loading ? (
        <p className="text-sm text-ink-400">加载中…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-ink-400">
          {query ? '没有匹配的笔记' : '还没有笔记，点击「新建」开始'}
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <Link
              key={note.id}
              href={`/notes/${note.id}`}
              className="block rounded-lg border border-ink-200 bg-white px-4 py-3 hover:border-accent"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink-900">{note.title || '无标题'}</div>
                  <div className="mt-1 truncate text-sm text-ink-400">
                    {note.content.slice(0, 100) || '（空）'}
                  </div>
                  {note.tags.length > 0 && (
                    <div className="mt-1 flex gap-1">
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
                </div>
                <div className="ml-4 shrink-0 text-xs text-ink-400">
                  {new Date(note.updatedAt).toLocaleDateString('zh-CN')}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
