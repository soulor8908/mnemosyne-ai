import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/layout/app-shell';

export const metadata: Metadata = {
  title: 'Mnemosyne · 你的第二大脑',
  description: 'AI 时代的云笔记 —— 让 AI 替你维护知识库，思考永不丢失，永远属于你自己',
  manifest: '/manifest.json',
  applicationName: 'Mnemosyne',
  appleWebApp: {
    capable: true,
    title: 'Mnemosyne',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
