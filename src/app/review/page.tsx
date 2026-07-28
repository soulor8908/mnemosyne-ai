// FSRS 复习页
'use client';

import { useEffect, useState } from 'react';
import { Rating, type Grade } from 'ts-fsrs';
import { getTodayReviewQueue, reviewCard } from '@/lib/fsrs/scheduler';
import { getNote } from '@/lib/db/notes';
import { Icon } from '@/components/ui/icon';
import type { ReviewCard } from '@/types';

const RATINGS: Array<{ value: Grade; label: string; color: string }> = [
  { value: Rating.Again, label: '忘了', color: 'bg-red-500' },
  { value: Rating.Hard, label: '困难', color: 'bg-orange-500' },
  { value: Rating.Good, label: '良好', color: 'bg-green-500' },
  { value: Rating.Easy, label: '简单', color: 'bg-blue-500' },
];

export default function ReviewPage() {
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const q = await getTodayReviewQueue();
    setQueue(q);
    setLoading(false);
    if (q.length > 0) {
      const note = await getNote(q[0].noteId);
      setNoteTitle(note?.title ?? '');
    }
  }

  useEffect(() => {
    if (queue[currentIdx]) {
      setShowBack(false);
      getNote(queue[currentIdx].noteId).then((n) => setNoteTitle(n?.title ?? ''));
    }
  }, [currentIdx, queue]);

  async function handleRate(rating: Grade) {
    const card = queue[currentIdx];
    if (!card) return;
    await reviewCard(card.id, rating);
    const nextIdx = currentIdx + 1;
    if (nextIdx >= queue.length) {
      // 完成
      setQueue([]);
      setCurrentIdx(0);
    } else {
      setCurrentIdx(nextIdx);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-400">加载中…</div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="mb-6 text-xl font-semibold text-ink-900 sm:text-2xl">复习</h1>
        <div className="rounded-lg border border-ink-200 bg-white p-8 text-center">
          <div className="mb-3 flex justify-center text-green-500">
            <Icon name="check" size={36} />
          </div>
          <p className="font-medium text-ink-700">今日复习已完成</p>
          <p className="mt-1 text-sm text-ink-400">稍后再来看看，或写些新笔记让 AI 生成更多卡片。</p>
        </div>
      </div>
    );
  }

  const card = queue[currentIdx];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-900 sm:text-2xl">复习</h1>
        <span className="text-sm text-ink-400">
          {currentIdx + 1} / {queue.length}
        </span>
      </div>

      {/* 进度条 */}
      <div className="mb-6 h-1 rounded-full bg-ink-200">
        <div
          className="h-1 rounded-full bg-accent transition-all"
          style={{ width: `${(currentIdx / queue.length) * 100}%` }}
        />
      </div>

      {/* 卡片 */}
      <div className="rounded-xl border border-ink-200 bg-white p-8 shadow-sm">
        <div className="mb-4 text-xs text-ink-400">来源：{noteTitle}</div>
        <div className="mb-6">
          <div className="mb-2 text-xs font-medium text-ink-500">问题</div>
          <div className="text-lg text-ink-900">{card.front}</div>
        </div>

        {showBack ? (
          <div className="mb-6">
            <div className="mb-2 text-xs font-medium text-ink-500">答案</div>
            <div className="markdown-body text-ink-800 whitespace-pre-wrap">{card.back}</div>
          </div>
        ) : (
          <button
            onClick={() => setShowBack(true)}
            className="mb-6 w-full rounded-lg border border-ink-200 py-2 text-sm text-ink-600 hover:bg-ink-50"
          >
            显示答案
          </button>
        )}

        {showBack && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                onClick={() => handleRate(r.value)}
                className={`rounded-lg py-2 text-sm text-white ${r.color} hover:opacity-90`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
