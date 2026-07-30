// AI 提议收件箱
'use client';

import { useEffect, useState } from 'react';
import { listProposals, decideProposal } from '@/lib/db/proposals';
import { applyProposal, runAgent } from '@/lib/ai/agent/runner';
import { apiFetch } from '@/lib/api/client';
import type { Proposal } from '@/types';

// 客户端 LLM 调用：通过 /api/chat 路由，服务端用 BYOK Key 或 Trial 模式调用大模型
// 这是修复的关键：旧实现把 stub env ({ AI: {} as any }) 传给 runAgent，
// 导致 callLLM 内部 env.AI.run() 抛 "AI.run is not a function"，
// 被 try/catch 静默吞掉，复习卡提议永远不生成，UI 还显示"Agent 运行完成"。
async function clientLLMCall(
  prompt: string,
  opts: { system?: string; maxTokens?: number; temperature?: number }
): Promise<string> {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: prompt }],
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Agent LLM 调用失败: ${res.status}`);
  }
  // /api/chat 走 SSE 流式；累积所有 chunk 拼成完整文本
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  // 简单累积：服务端目前用 streamText 输出文本 token，这里直接拼字节
  // 如未来切到严格 SSE 帧，需解析 data: 前缀
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
  }
  return full;
}

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
      // 客户端调用：注入 clientLLMCall，不再传 stub env
      const runId = await runAgent({
        llmCall: clientLLMCall,
        trigger: 'manual',
      });
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
                {p.payload.method === 'embedding-cosine' && (
                  <span
                    className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600"
                    title="基于笔记向量余弦相似度计算，不代表模型真正理解了语义关联"
                  >
                    向量余弦
                  </span>
                )}
                {p.payload.method === 'llm' && (
                  <span className="rounded bg-purple-50 px-2 py-0.5 text-xs text-purple-600">
                    LLM 生成
                  </span>
                )}
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
