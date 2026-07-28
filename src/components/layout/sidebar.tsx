'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { countNotes } from '@/lib/db/notes';
import { countPendingProposals } from '@/lib/db/proposals';
import { getTodayReviewQueue } from '@/lib/fsrs/scheduler';
import { initMasterKey } from '@/lib/auth/user-prefs';

const NAV_ITEMS = [
  { href: '/', label: '今日', icon: '☀' },
  { href: '/notes', label: '笔记', icon: '✎' },
  { href: '/recall', label: '检索', icon: '🔍' },
  { href: '/review', label: '复习', icon: '↻' },
  { href: '/proposals', label: '提议', icon: '✦' },
  { href: '/settings', label: '设置', icon: '⚙' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [noteCount, setNoteCount] = useState(0);
  const [pendingProposals, setPendingProposals] = useState(0);
  const [reviewQueue, setReviewQueue] = useState(0);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        await initMasterKey();
        setInitialized(true);
        const [nc, pp, rq] = await Promise.all([
          countNotes(),
          countPendingProposals(),
          getTodayReviewQueue(),
        ]);
        setNoteCount(nc);
        setPendingProposals(pp);
        setReviewQueue(rq.length);
      } catch (err) {
        console.error('初始化失败', err);
      }
    }
    init();
  }, []);

  return (
    <aside className="flex w-56 flex-col border-r border-ink-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white font-bold">
          M
        </div>
        <span className="font-semibold text-ink-900">Mnemosyne</span>
      </div>

      <nav className="flex-1 px-2 py-2">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const badge =
            item.href === '/review'
              ? reviewQueue
              : item.href === '/proposals'
                ? pendingProposals
                : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-0.5 flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-ink-100 font-medium text-ink-900'
                  : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-base">{item.icon}</span>
                {item.label}
              </span>
              {badge > 0 && (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-200 px-4 py-3">
        <div className="text-xs text-ink-400">
          {initialized ? (
            <>
              <p>笔记 {noteCount} 条</p>
              <p className="mt-1">本地优先 · 加密同步</p>
            </>
          ) : (
            <p>初始化中…</p>
          )}
        </div>
      </div>
    </aside>
  );
}
