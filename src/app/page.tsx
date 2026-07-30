// 今日首页：快速捕获 + 待复习 + 提议收件箱概览
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createNote, getRecentNotes } from '@/lib/db/notes';
import { listProposals } from '@/lib/db/proposals';
import { getTodayReviewQueue } from '@/lib/fsrs/scheduler';
import { embedNote } from '@/lib/ai/embed';
import type { Note, Proposal } from '@/types';

export default function TodayPage() {
  const [quickText, setQuickText] = useState('');
  const [recent, setRecent] = useState<Note[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const [r, p, rq] = await Promise.all([
      getRecentNotes(3),
      listProposals({ status: 'pending', limit: 5 }),
      getTodayReviewQueue(),
    ]);
    setRecent(r);
    setProposals(p);
    setReviewCount(rq.length);
  }

  async function handleQuickSave() {
    const text = quickText.trim();
    if (!text) return;
    setSaving(true);
    try {
      const note = await createNote({ content: text, source: 'manual' });
      // 异步生成嵌入（不阻塞）
      embedNote(note.id, note.content).catch((e) => console.error('embed failed', e));
      setQuickText('');
      refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="mb-6 text-xl font-semibold text-ink-900 sm:text-2xl">今日</h1>

      {/* 快速捕获 */}
      <section className="mb-8">
        <label className="mb-2 block text-sm text-ink-500">快速记录一个想法</label>
        <textarea
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              handleQuickSave();
            }
          }}
          placeholder="按 Cmd/Ctrl + Enter 保存…"
          className="w-full resize-none rounded-lg border border-ink-200 bg-white px-4 py-3 text-ink-900 placeholder-ink-400 focus:border-accent focus:outline-none"
          rows={3}
        />
        <div className="mt-2 flex items-center justify-between">
          <Link href="/capture" className="text-sm text-accent hover:underline">
            或捕获网页 →
          </Link>
          <button
            onClick={handleQuickSave}
            disabled={saving || !quickText.trim()}
            className="rounded-md bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </section>

      {/* 复习队列 */}
      {reviewCount > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium text-ink-900">待复习</h2>
            <Link href="/review" className="text-sm text-accent hover:underline">
              查看全部
            </Link>
          </div>
          <Link
            href="/review"
            className="block rounded-lg border border-ink-200 bg-white px-4 py-3 hover:border-accent"
          >
            <span className="text-ink-900">{reviewCount} 张卡片待复习</span>
            <span className="ml-2 text-sm text-ink-400">点击开始</span>
          </Link>
        </section>
      )}

      {/* AI 提议 */}
      {proposals.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium text-ink-900">AI 提议</h2>
            <Link href="/proposals" className="text-sm text-accent hover:underline">
              查看全部
            </Link>
          </div>
          <div className="space-y-2">
            {proposals.slice(0, 3).map((p) => (
              <Link
                key={p.id}
                href="/proposals"
                className="block rounded-lg border border-ink-200 bg-white px-4 py-3 hover:border-accent"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                    {p.type}
                  </span>
                  <span className="text-sm text-ink-700">{p.reason.slice(0, 60)}…</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 最近笔记 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-ink-900">最近笔记</h2>
          <Link href="/notes" className="text-sm text-accent hover:underline">
            查看全部
          </Link>
        </div>
        <div className="space-y-2">
          {recent.length === 0 ? (
            <p className="text-sm text-ink-400">还没有笔记，从上面开始记录吧。</p>
          ) : (
            recent.map((note) => (
              <Link
                key={note.id}
                href={`/notes/${note.id}`}
                className="block rounded-lg border border-ink-200 bg-white px-4 py-3 hover:border-accent"
              >
                <div className="font-medium text-ink-900">{note.title}</div>
                <div className="mt-1 text-sm text-ink-400">
                  {note.content.slice(0, 80) || '（空笔记）'}
                </div>
                <div className="mt-1 text-xs text-ink-400">
                  {new Date(note.updatedAt).toLocaleString('zh-CN')}
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
