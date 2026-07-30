// 网页剪藏页：粘贴链接 → 服务端抓取正文 → 落库为笔记
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createNote } from '@/lib/db/notes';
import { apiFetch } from '@/lib/api/client';

export default function CapturePage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCapture(e: React.FormEvent) {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? res.statusText);
      }
      const data = (await res.json()) as {
        title: string;
        content: string;
        url: string;
        capturedAt: number;
      };
      const note = await createNote({
        title: data.title || u,
        content: `# ${data.title}\n\n${data.content}\n\n> 来源：${data.url}`,
        source: 'web',
        sourceMeta: { url: data.url, capturedAt: data.capturedAt },
      });
      router.push(`/notes/${note.id}`);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="mb-1 text-xl font-semibold text-ink-900 sm:text-2xl">捕获网页</h1>
      <p className="mb-6 text-sm text-ink-400">
        粘贴文章链接，服务端抓取正文并保存为笔记（绕开浏览器跨域限制）。
      </p>

      <form onSubmit={handleCapture}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          className="w-full rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm placeholder-ink-400 focus:border-accent focus:outline-none"
          autoFocus
          disabled={loading}
        />
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="rounded-md bg-accent px-5 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? '抓取中…' : '抓取并保存'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          抓取失败：{error}
        </div>
      )}
    </div>
  );
}
