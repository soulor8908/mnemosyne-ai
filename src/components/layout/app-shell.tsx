'use client';

import { useState } from 'react';
import { Sidebar } from './sidebar';
import { Icon } from '@/components/ui/icon';

// 桌面端固定侧边栏 + 移动端抽屉式侧边栏 + 顶部汉堡菜单按钮
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col overflow-hidden lg:flex-row">
      {/* 移动端顶部栏 */}
      <header className="flex items-center justify-between border-b border-ink-200 bg-white px-4 py-2.5 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 text-ink-600 hover:bg-ink-100"
          aria-label="打开菜单"
        >
          <Icon name="menu" size={22} />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white">
            <Icon name="logo" size={16} />
          </div>
          <span className="font-semibold text-ink-900">Mnemosyne</span>
        </div>
        <div className="w-9" />
      </header>

      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <main className="flex-1 overflow-y-auto bg-ink-50">{children}</main>
    </div>
  );
}
