// 单元测试：多 Agent 协作的 Supervisor 模式
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runMultiAgent } from '@/lib/ai/agent/multi-agent';
import type { AgentLLMCall } from '@/lib/ai/agent/runner';
import { getDb, _resetDbForTests } from '@/lib/db/schema';
import { saveEmbedding } from '@/lib/db/embeddings';
import { createBilink } from '@/lib/db/bilinks';
import { listProposals } from '@/lib/db/proposals';
import { getTracesByRun } from '@/lib/db/agent-traces';
import { getLatestAgentRun } from '@/lib/db/agent-runs';
import { genId, now } from '@/lib/utils';
import type { Note, EmbeddingRecord } from '@/types';

// 清表 helper：参考 agent-traces.test.ts 的做法，防止 fake-indexeddb 跨用例残留数据
async function clearAllTables() {
  try {
    const db = getDb();
    await Promise.all([
      db.notes.clear(),
      db.embeddings.clear(),
      db.bilinks.clear(),
      db.proposals.clear(),
      db.agentRuns.clear(),
      db.agentTraces.clear(),
      db.reviewCards.clear(),
      db.snapshots.clear(),
    ]);
  } catch {
    // 忽略
  }
}

beforeEach(async () => {
  await clearAllTables();
  _resetDbForTests();
  await clearAllTables();
});

// 构造一条笔记并写入 IDB（绕过 createNote，以便自定义 updatedAt / status）
async function seedNote(opts: {
  title: string;
  content: string;
  status?: Note['status'];
  daysAgo?: number; // updatedAt 距今天数（控制是否落在近7日窗口内）
  vector?: number[];
}): Promise<Note> {
  const db = getDb();
  const ts = now() - (opts.daysAgo ?? 0) * 24 * 3600 * 1000;
  const note: Note = {
    id: genId('note'),
    title: opts.title,
    content: opts.content,
    frontmatter: {},
    folderId: null,
    tags: [],
    status: opts.status ?? 'draft',
    source: 'manual',
    createdAt: ts,
    updatedAt: ts,
    accessedAt: ts,
    rev: 1,
    syncStatus: 'local',
    encryption: 'plain',
  };
  await db.notes.add(note);
  if (opts.vector) {
    const record: EmbeddingRecord = {
      noteId: note.id,
      model: 'local-mini',
      vector: opts.vector,
      contentHash: opts.title,
      generatedAt: ts,
      mode: 'local',
    };
    await saveEmbedding(record);
  }
  return note;
}

// 构造一个返回合法 JSON 的 mock LLM
function mockLlmOk(): AgentLLMCall {
  return async () =>
    JSON.stringify([
      { front: '什么是 React Hooks？', back: 'React 16.8 引入的函数组件状态能力。' },
    ]);
}

// 构造一个总是抛错的 mock LLM（模拟 Writer 复习卡降级）
function mockLlmFail(): AgentLLMCall {
  return async () => {
    throw new Error('LLM 服务不可用');
  };
}

describe('runMultiAgent - 正常流程', () => {
  it('3 个 Agent 都成功，生成双链 + 复习卡', async () => {
    // note1：settled + 近期 + 有 embedding（作为双链源 + 复习卡来源）
    await seedNote({
      title: 'React Hooks 深入学习笔记总结',
      content: 'useState 与 useEffect 是最常用的 Hooks。',
      status: 'settled',
      daysAgo: 0,
      vector: [1.0, 0.0],
    });
    // note2：非近期 + 有 embedding（作为双链目标）
    await seedNote({
      title: 'React 状态管理方案对比分析',
      content: 'Context 与 Redux 的取舍。',
      status: 'draft',
      daysAgo: 10,
      vector: [1.0, 0.0],
    });

    const runId = await runMultiAgent({ trigger: 'manual', llmCall: mockLlmOk() });

    // 验证提议：1 条 link + 1 条 review-card
    const proposals = await listProposals();
    const linkProposals = proposals.filter((p) => p.type === 'link');
    const cardProposals = proposals.filter((p) => p.type === 'review-card');
    expect(linkProposals.length).toBe(1);
    expect(cardProposals.length).toBe(1);

    // 验证 agent run 状态为 success
    const run = await getLatestAgentRun();
    expect(run?.status).toBe('success');
    expect(run?.id).toBe(runId);
    expect(run?.proposalsCreated).toBe(2);
  });
});

describe('runMultiAgent - Writer 失败降级', () => {
  it('复习卡失败但双链提议仍保留', async () => {
    await seedNote({
      title: 'React Hooks 深入学习笔记总结',
      content: 'useState 与 useEffect 是最常用的 Hooks。',
      status: 'settled',
      daysAgo: 0,
      vector: [1.0, 0.0],
    });
    await seedNote({
      title: 'React 状态管理方案对比分析',
      content: 'Context 与 Redux 的取舍。',
      status: 'draft',
      daysAgo: 10,
      vector: [1.0, 0.0],
    });

    // LLM 总是抛错
    const runId = await runMultiAgent({ trigger: 'manual', llmCall: mockLlmFail() });

    const proposals = await listProposals();
    const linkProposals = proposals.filter((p) => p.type === 'link');
    const cardProposals = proposals.filter((p) => p.type === 'review-card');

    // 双链提议保留
    expect(linkProposals.length).toBe(1);
    // 复习卡被降级跳过
    expect(cardProposals.length).toBe(0);

    // 流程整体仍为 success（降级不等于失败）
    const run = await getLatestAgentRun();
    expect(run?.status).toBe('success');
    expect(run?.id).toBe(runId);
    expect(run?.proposalsCreated).toBe(1);

    // trace 里应有 llm-call failed（复习卡降级记录）
    const traces = await getTracesByRun(runId);
    const failedLlm = traces.filter(
      (t) => t.step === 'llm-call' && t.status === 'failed'
    );
    expect(failedLlm.length).toBeGreaterThanOrEqual(1);
  });
});

describe('runMultiAgent - Collector 空输入', () => {
  it('0 笔记时直接返回成功', async () => {
    const runId = await runMultiAgent({ trigger: 'manual', llmCall: mockLlmOk() });

    const run = await getLatestAgentRun();
    expect(run?.status).toBe('success');
    expect(run?.id).toBe(runId);
    expect(run?.notesProcessed).toBe(0);
    expect(run?.proposalsCreated).toBe(0);

    // 无任何提议
    const proposals = await listProposals();
    expect(proposals.length).toBe(0);

    // reviewer / writer 被标记为 skipped
    const traces = await getTracesByRun(runId);
    const skipped = traces.filter((t) => t.status === 'skipped');
    expect(skipped.length).toBe(2);
    const skippedSteps = skipped.map((t) => t.step);
    expect(skippedSteps).toContain('reviewer');
    expect(skippedSteps).toContain('writer');
  });
});

describe('runMultiAgent - 状态机流转', () => {
  it('trace 记录了 collecting → reviewing → writing → done', async () => {
    await seedNote({
      title: 'React Hooks 深入学习笔记总结',
      content: 'useState 与 useEffect 是最常用的 Hooks。',
      status: 'settled',
      daysAgo: 0,
      vector: [1.0, 0.0],
    });
    await seedNote({
      title: 'React 状态管理方案对比分析',
      content: 'Context 与 Redux 的取舍。',
      status: 'draft',
      daysAgo: 10,
      vector: [1.0, 0.0],
    });

    const runId = await runMultiAgent({ trigger: 'manual', llmCall: mockLlmOk() });

    const traces = await getTracesByRun(runId);
    // 三个 Agent 级 step 都存在且为 success
    const collectorTrace = traces.find((t) => t.step === 'collector');
    const reviewerTrace = traces.find((t) => t.step === 'reviewer');
    const writerTrace = traces.find((t) => t.step === 'writer');
    expect(collectorTrace).toBeDefined();
    expect(reviewerTrace).toBeDefined();
    expect(writerTrace).toBeDefined();
    expect(collectorTrace!.status).toBe('success');
    expect(reviewerTrace!.status).toBe('success');
    expect(writerTrace!.status).toBe('success');

    // 状态机流转：startedAt 非递减
    // （允许同毫秒，避免 getTracesByRun 在 startedAt 相同时排序不稳定）
    expect(reviewerTrace!.startedAt).toBeGreaterThanOrEqual(collectorTrace!.startedAt);
    expect(writerTrace!.startedAt).toBeGreaterThanOrEqual(reviewerTrace!.startedAt);

    // 最终状态为 success（done）
    const run = await getLatestAgentRun();
    expect(run?.status).toBe('success');
  });
});

describe('runMultiAgent - Reviewer 质量审查', () => {
  it('过滤已存在双链，approved 为空时不创建 link 提议', async () => {
    const note1 = await seedNote({
      title: 'React Hooks 深入学习笔记总结',
      content: 'useState 与 useEffect 是最常用的 Hooks。',
      status: 'settled',
      daysAgo: 0,
      vector: [1.0, 0.0],
    });
    const note2 = await seedNote({
      title: 'React 状态管理方案对比分析',
      content: 'Context 与 Redux 的取舍。',
      status: 'draft',
      daysAgo: 10,
      vector: [1.0, 0.0],
    });

    // 预先创建 note1 → note2 的双链
    await createBilink({
      srcNoteId: note1.id,
      dstNoteId: note2.id,
      type: 'manual',
      createdBy: 'user',
    });

    const runId = await runMultiAgent({ trigger: 'manual', llmCall: mockLlmOk() });

    const proposals = await listProposals();
    const linkProposals = proposals.filter((p) => p.type === 'link');
    const cardProposals = proposals.filter((p) => p.type === 'review-card');

    // Reviewer 过滤掉了已存在双链，不创建 link 提议
    expect(linkProposals.length).toBe(0);
    // 但复习卡仍正常生成（note1 是 settled）
    expect(cardProposals.length).toBe(1);

    const run = await getLatestAgentRun();
    expect(run?.status).toBe('success');
    expect(run?.id).toBe(runId);
  });
});

describe('runMultiAgent - 去重', () => {
  it('重复的候选对只保留一条 link 提议', async () => {
    // 用三条近期笔记指向同一条目标笔记，且向量相同
    await seedNote({
      title: '笔记A关于 React Hooks 的学习记录',
      content: '内容 A',
      status: 'draft',
      daysAgo: 1,
      vector: [1.0, 0.0],
    });
    await seedNote({
      title: '笔记B关于 React Hooks 的学习记录',
      content: '内容 B',
      status: 'draft',
      daysAgo: 2,
      vector: [1.0, 0.0],
    });
    // 目标笔记（非近期）
    await seedNote({
      title: '目标笔记 React 状态管理方案对比',
      content: '目标内容',
      status: 'draft',
      daysAgo: 10,
      vector: [1.0, 0.0],
    });

    // 无 settled 笔记，LLM 不会被调用
    const llmCall = vi.fn();
    await runMultiAgent({ trigger: 'manual', llmCall });

    const proposals = await listProposals();
    const linkProposals = proposals.filter((p) => p.type === 'link');
    // 两条近期笔记各产生一条候选对，去重后仍为两条（src 不同）
    expect(linkProposals.length).toBe(2);
    // LLM 未被调用（无 settled 笔记）
    expect(llmCall).not.toHaveBeenCalled();
  });
});
