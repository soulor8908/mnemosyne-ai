// 语义检索页：自然语言问答 + 结果列表
'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { hybridSearch, keywordSearch, type SearchResult } from '@/lib/ai/search';
import { formatSourcesForPrompt, GROUNDING_REFUSAL } from '@/lib/ai/grounding';
import { apiFetch } from '@/lib/api/client';

export default function RecallPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setAnswer('');
    try {
      // 先尝试混合检索（需要嵌入）
      let res: SearchResult[];
      try {
        res = await hybridSearch(q, 5);
        if (res.length === 0) res = await keywordSearch(q, 5);
      } catch {
        // 嵌入失败（如 transformers.js 未加载），降级关键词
        res = await keywordSearch(q, 5);
      }
      setResults(res);

      // 溯源 + 拒答：无任何相关笔记时，诚实地拒答，绝不调用 LLM 编造
      if (res.length === 0) {
        setAnswer(GROUNDING_REFUSAL);
        return;
      }
      streamAnswer(q, res);
    } finally {
      setLoading(false);
    }
  }

  async function streamAnswer(q: string, res: SearchResult[]) {
    setStreaming(true);
    abortRef.current = new AbortController();

    const context = formatSourcesForPrompt(res);

    try {
      const resp = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: q }],
          context,
        }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setAnswer(`（AI 回答不可用：${err.error ?? resp.statusText}）`);
        return;
      }

      // 流式读取
      const reader = resp.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        // 简单展示（实际应解析 SSE/data stream 协议）
        setAnswer(acc);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setAnswer(`（回答失败：${(err as Error).message}）`);
      }
    } finally {
      setStreaming(false);
    }
  }

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="mb-6 text-xl font-semibold text-ink-900 sm:text-2xl">检索</h1>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="用自然语言提问，从你的笔记中找答案…"
            className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm placeholder-ink-400 focus:border-accent focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="shrink-0 rounded-md bg-accent px-5 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? '检索中…' : '检索'}
          </button>
        </div>
      </form>

      {answer && (
        <div className="mb-6 rounded-lg border border-ink-200 bg-white p-4">
          <div className="mb-2 text-xs font-medium text-ink-400">AI 回答</div>
          <div className="markdown-body text-sm whitespace-pre-wrap">{answer}</div>
          {streaming && <span className="text-xs text-ink-400">…</span>}
        </div>
      )}

      {results.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-medium text-ink-500">
            引用来源（{results.length}）
          </h2>
          <p className="mb-3 text-xs text-ink-400">
            AI 回答基于以下笔记，可点击核对出处
          </p>
          <div className="space-y-2">
            {results.map((r, i) => (
              <Link
                key={r.note.id}
                href={`/notes/${r.note.id}`}
                className="block rounded-lg border border-ink-200 bg-white px-4 py-3 hover:border-accent"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-medium text-ink-600">
                      {i + 1}
                    </span>
                    <span className="font-medium text-ink-900">{r.note.title}</span>
                  </div>
                  <span className="text-xs text-ink-400">
                    {r.matchedBy === 'both' ? '关键词+语义' : r.matchedBy === 'semantic' ? '语义' : '关键词'}
                    {' · '}
                    {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 text-sm text-ink-400">
                  {r.note.content.slice(0, 120) || '（空）'}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!loading && results.length === 0 && query && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm font-medium text-amber-800">未找到相关笔记</p>
          <p className="mt-1 text-sm text-amber-700">
            为避免编造，AI 未作答。换个说法，或去「笔记」补充相关内容后再试。
          </p>
        </div>
      )}
    </div>
  );
}
