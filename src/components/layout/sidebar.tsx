'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { countNotes } from '@/lib/db/notes';
import { countPendingProposals } from '@/lib/db/proposals';
import { getTodayReviewQueue } from '@/lib/fsrs/scheduler';
import { initMasterKey } from '@/lib/auth/user-prefs';
import { Icon, type IconName } from '@/components/ui/icon';

const NAV_ITEMS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/', label: '今日', icon: 'home' },
  { href: '/notes', label: '笔记', icon: 'note' },
  { href: '/recall', label: '检索', icon: 'search' },
  { href: '/review', label: '复习', icon: 'refresh' },
  { href: '/proposals', label: '提议', icon: 'sparkles' },
  { href: '/settings', label: '设置', icon: 'settings' },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
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

  // 路由变化时关闭移动端抽屉
  useEffect(() => {
    if (mobileOpen && onClose) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // 防止移动端抽屉打开时 body 滚动
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [mobileOpen]);

  const content = (
    <aside className="flex h-full w-64 flex-col border-r border-ink-200 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
            <Icon name="logo" size={18} />
          </div>
          <span className="font-semibold text-ink-900">Mnemosyne</span>
        </Link>
        {/* 移动端关闭按钮 */}
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 lg:hidden"
            aria-label="关闭菜单"
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2">
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
              <span className="flex items-center gap-2.5">
                <Icon name={item.icon} size={18} className={active ? 'text-accent' : ''} />
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

  return (
    <>
      {/* 桌面端：固定侧边栏 */}
      <div className="hidden lg:block">{content}</div>

      {/* 移动端：抽屉 + 遮罩 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 h-full shadow-xl">{content}</div>
        </div>
      )}
    </>
  );
}
