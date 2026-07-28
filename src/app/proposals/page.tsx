// AI 提议收件箱
'use client';

import { useEffect, useState } from 'react';
import { listProposals, decideProposal } from '@/lib/db/proposals';
import { applyProposal } from '@/lib/ai/agent/runner';
import { runAgent } from '@/lib/ai/agent/runner';
import type { Proposal } from '@/types';

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [running, setRunning] = useState(false);
  const [agentResult, setAgentResult] = useState<string>('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const list = await listProposals({ status: 'pending', limit: 100 });
    setProposals(list);
  }

  async function handleAccept(id: string) {
    await applyProposal(id);
    setProposals((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleDismiss(id: string) {
    await decideProposal(id, 'dismissed');
    setProposals((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleRunAgent() {
    setRunning(true);
    setAgentResult('');
    try {
      // Agent 需要浏览器上下文（IndexedDB），直接调用客户端逻辑
      // byokKeys 通过 fetch 获取（这里简化，Agent 会用本地缓存的 key）
      const runId = await runAgent(
        // env 在客户端不可用，传一个最小占位
        { AI: {} as any, KV: {} as any, NOTES_DELTA: {} as any, AUTH_SESSIONS: {} as any, AUTH_NONCES: {} as any, AUTH_AUDIT: {} as any, ASSETS: {} as any, AI_PROVIDER: 'deepseek', APP_URL: '' },
        undefined,
        'manual'
      );
      setAgentResult(`Agent 运行完成（runId: ${runId}）`);
      await load();
    } catch (err) {
      setAgentResult(`运行失败：${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink-900 sm:text-2xl">AI 提议</h1>
        <button
          onClick={handleRunAgent}
          disabled={running}
          className="shrink-0 rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
        >
          {running ? '整理中…' : '手动整理'}
        </button>
      </div>

      {agentResult && (
        <div className="mb-4 rounded-lg border border-ink-200 bg-white px-4 py-3 text-sm text-ink-600">
          {agentResult}
        </div>
      )}

      {proposals.length === 0 ? (
        <div className="rounded-lg border border-ink-200 bg-white p-8 text-center">
          <p className="text-ink-400">暂无待确认的提议</p>
          <p className="mt-1 text-sm text-ink-400">
            写几篇笔记后，点击「手动整理」让 AI 发现关联
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <div
              key={p.id}
              className="rounded-lg border border-ink-200 bg-white p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-600">
                  {p.type}
                </span>
                <span className="text-xs text-ink-400">
                  置信度 {(p.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <p className="mb-3 text-sm text-ink-700">{p.reason}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAccept(p.id)}
                  className="rounded-md bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover"
                >
                  接受
                </button>
                <button
                  onClick={() => handleDismiss(p.id)}
                  className="rounded-md border border-ink-200 px-3 py-1 text-xs text-ink-600 hover:bg-ink-50"
                >
                  忽略
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
