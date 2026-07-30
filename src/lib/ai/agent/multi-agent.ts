// 多 Agent 协作的 Supervisor 模式（技术设计文档 5.4 升级）
//
// 将原 runAgent 拆分为三个专门 Agent + 一个 Supervisor 编排：
// - Collector Agent：收集候选笔记（加载近7日笔记 + 计算嵌入相似度 + 找出关联候选）
// - Reviewer Agent：质量审查（置信度排序、去重、过滤已存在双链）
// - Writer Agent：内容产出（生成双链 reason 文案 + 调用 LLM 生成复习卡）
// - Supervisor：状态机编排，记录每个 Agent 执行轨迹，失败降级不中断
//
// 设计原则：
//   1. 复用现有 DAO（getRecentNotes / getAllEmbeddings / cosineSimilarity / findBilink / createProposal 等）
//   2. 保持与 runAgent 相同的入口接口（RunAgentOptions），方便切换
//   3. Agent 间数据契约用 TypeScript interface 明确定义，避免隐式耦合
//   4. Writer 失败时降级：双链提议保留，复习卡跳过，不中断主流程
import { getRecentNotes, getNotesByIds } from '@/lib/db/notes';
import { createProposal } from '@/lib/db/proposals';
import { startAgentRun, finishAgentRun } from '@/lib/db/agent-runs';
import { traceStep, recordTrace } from '@/lib/db/agent-traces';
import { findBilink } from '@/lib/db/bilinks';
import { getAllEmbeddings } from '@/lib/db/embeddings';
import { cosineSimilarity, truncate, now } from '@/lib/utils';
import type { Note, ProposalPayload } from '@/types';
// 复用 runner.ts 的接口与解析工具，避免重复定义
import { parseReviewCards, type AgentLLMCall, type RunAgentOptions } from './runner';

// 状态机：idle → collecting → reviewing → writing → done（或 failed）
export type MultiAgentState = 'idle' | 'collecting' | 'reviewing' | 'writing' | 'done' | 'failed';

// ---- Agent 间数据契约 ----

// 候选关联对：一条潜在的双链关系
export interface CandidatePair {
  srcNote: Note;
  dstNote: Note;
  confidence: number;
}

// Collector 输出：候选关联对列表 + 近期笔记（透传给 Writer 生成复习卡）
export interface CollectorOutput {
  candidates: CandidatePair[];
  recentNotes: Note[];
}

// Reviewer 输出：经审查后的关联对
export interface ReviewerOutput {
  approved: CandidatePair[];
  recentNotes: Note[];
}

// Writer 输出：已创建的提议摘要
export interface WriterOutput {
  linkProposals: ProposalPayload[];
  reviewCards: Array<{ noteId: string; card: { front: string; back: string } }>;
}

// 默认参数
const SIM_THRESHOLD = 0.6;   // 向量余弦相似度阈值
const TOP_N = 10;             // Reviewer 取 top N
const REVIEW_CARD_NOTE_LIMIT = 5; // Writer 最多为多少条 settled 笔记生成复习卡

// ---- Collector Agent ----
// 加载近7日笔记 + 计算嵌入余弦相似度，输出候选关联对列表
// runId 预留用于 trace 关联（Supervisor 层统一记录）
async function runCollector(_runId: string): Promise<CollectorOutput> {
  const recentNotes = await getRecentNotes(7);
  if (recentNotes.length === 0) {
    return { candidates: [], recentNotes: [] };
  }

  const allEmbeddings = await getAllEmbeddings();
  const recentEmbeddings = allEmbeddings.filter((e) =>
    recentNotes.some((n) => n.id === e.noteId)
  );

  // 性能优化：批量预加载所有候选目标笔记到 Map，避免 O(N×M) IDB 往返
  const candidateIds = Array.from(
    new Set(
      allEmbeddings
        .map((e) => e.noteId)
        .filter((id) => !recentNotes.some((n) => n.id === id))
    )
  );
  const candidateNotes = await getNotesByIds(candidateIds);
  const candidateMap = new Map<string, Note>(candidateNotes.map((n) => [n.id, n]));
  const recentMap = new Map<string, Note>(recentNotes.map((n) => [n.id, n]));

  const candidates: CandidatePair[] = [];
  for (const re of recentEmbeddings) {
    const srcNote = recentMap.get(re.noteId);
    if (!srcNote) continue;
    for (const oe of allEmbeddings) {
      if (oe.noteId === re.noteId) continue;
      const dstNote = candidateMap.get(oe.noteId);
      if (!dstNote || dstNote.status === 'archived') continue;
      const sim = cosineSimilarity(re.vector, oe.vector);
      if (sim >= SIM_THRESHOLD) {
        candidates.push({ srcNote, dstNote, confidence: sim });
      }
    }
  }

  return { candidates, recentNotes };
}

// ---- Reviewer Agent ----
// 置信度排序取 top N + 按 (srcNote, dstNote) 去重 + 过滤已存在双链
async function runReviewer(runId: string, input: CollectorOutput): Promise<ReviewerOutput> {
  // 1. 按置信度降序排序
  const sorted = [...input.candidates].sort((a, b) => b.confidence - a.confidence);
  // 2. 取 top N
  const top = sorted.slice(0, TOP_N);
  // 3. 按 (srcNote.id, dstNote.id) 去重
  const seen = new Set<string>();
  const deduped: CandidatePair[] = [];
  for (const pair of top) {
    const key = `${pair.srcNote.id}|${pair.dstNote.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(pair);
  }
  // 4. 过滤已存在双链（复用 findBilink，避免重复提议）
  const approved: CandidatePair[] = [];
  for (const pair of deduped) {
    const existing = await findBilink(pair.srcNote.id, pair.dstNote.id);
    if (!existing) {
      approved.push(pair);
    }
  }
  return { approved, recentNotes: input.recentNotes };
}

// 解析 LLM 调用入口：优先用注入的 llmCall，否则用 env 走 callLLM
// 与 runAgent 保持一致的回退逻辑
function resolveLlmCall(opts: RunAgentOptions): AgentLLMCall {
  if (opts.llmCall) return opts.llmCall;
  return async (prompt, callOpts) => {
    if (!opts.env) {
      throw new Error('Agent LLM 调用未配置（需提供 llmCall 或 env）');
    }
    const { callLLM } = await import('../providers');
    return callLLM('agent', prompt, {
      byokKeys: opts.byokKeys,
      env: opts.env,
      system: callOpts.system,
      maxTokens: callOpts.maxTokens,
      temperature: callOpts.temperature,
    });
  };
}

// 为单条笔记生成复习卡（含一次重试），返回生成的卡片列表
// 复用 parseReviewCards 做 Zod 校验，替代正则裸解析
async function generateCardsForNote(
  runId: string,
  note: Note,
  llmCall: AgentLLMCall
): Promise<Array<{ front: string; back: string }>> {
  const prompt = `请从以下笔记中提取 1-2 个核心知识点，生成复习卡片。每张卡片包含 front（问题）和 back（答案）。

笔记标题：${note.title}
笔记内容：
${truncate(note.content, 1500)}

请以 JSON 数组格式返回：[{"front": "问题", "back": "答案"}]，不要其他文字。`;

  // 首次调用
  const llmStart = now();
  const response = await llmCall(prompt, {
    system: '你是复习卡片生成助手，只返回 JSON。',
    maxTokens: 500,
    temperature: 0.3,
  });
  await recordTrace(runId, 'llm-call', 'success', llmStart, { noteId: note.id, attempt: 1 });

  let parsed = parseReviewCards(response);
  if (parsed) {
    return parsed.cards.slice(0, 2);
  }

  // 解析失败，重试一次
  const retryStart = now();
  const retry = await llmCall(
    prompt + '\n\n【严格要求】只输出 JSON 数组，不要任何解释或 Markdown 代码块。',
    { system: '你是复习卡片生成助手，只返回 JSON。', maxTokens: 500, temperature: 0.2 }
  );
  await recordTrace(runId, 'retry-llm', 'success', retryStart, { noteId: note.id, attempt: 2 });

  parsed = parseReviewCards(retry);
  if (!parsed) {
    console.error('[Writer] 复习卡解析重试仍失败，跳过', note.id);
    return [];
  }
  return parsed.cards.slice(0, 2);
}

// ---- Writer Agent ----
// 生成双链 reason 文案（模板，不调 LLM）+ 调用 LLM 生成复习卡
// 复习卡失败时降级：双链提议仍保留，不中断
async function runWriter(
  runId: string,
  input: ReviewerOutput,
  opts: RunAgentOptions
): Promise<WriterOutput> {
  const linkProposals: ProposalPayload[] = [];
  const reviewCards: Array<{ noteId: string; card: { front: string; back: string } }> = [];

  // 子任务 A：为每个 approved pair 生成双链 reason（模板）并创建提议
  // 这部分不依赖 LLM，应当总能成功
  for (const pair of input.approved) {
    const payload: ProposalPayload = {
      srcNoteId: pair.srcNote.id,
      dstNoteId: pair.dstNote.id,
      confidence: pair.confidence,
      method: 'embedding-cosine',
    };
    const reason = `《${truncate(pair.srcNote.title, 30)}》与《${truncate(pair.dstNote.title, 30)}》向量余弦相似度 ${(pair.confidence * 100).toFixed(0)}%，建议建立双链。`;
    await createProposal({
      type: 'link',
      payload,
      reason,
      confidence: pair.confidence,
      agentRunId: runId,
    });
    linkProposals.push(payload);
  }

  // 子任务 B：调用 LLM 生成复习卡（失败降级，不中断双链提议）
  const llmCall = resolveLlmCall(opts);
  const settledNotes = input.recentNotes
    .filter((n) => n.status === 'settled')
    .slice(0, REVIEW_CARD_NOTE_LIMIT);

  for (const note of settledNotes) {
    try {
      const cards = await generateCardsForNote(runId, note, llmCall);
      for (const card of cards) {
        const cardPayload: ProposalPayload = { noteId: note.id, cards: [card] };
        await createProposal({
          type: 'review-card',
          payload: cardPayload,
          reason: `从《${truncate(note.title, 30)}》中提取复习卡：${truncate(card.front, 40)}`,
          confidence: 0.7,
          agentRunId: runId,
        });
        reviewCards.push({ noteId: note.id, card });
      }
    } catch (noteErr) {
      // 单条笔记复习卡失败，记录 trace 但不中断其他笔记
      await recordTrace(runId, 'llm-call', 'failed', now(), {
        noteId: note.id,
        errorType: (noteErr as Error).name,
        errorMessage: (noteErr as Error).message,
      });
      console.error('[Writer] 笔记复习卡生成失败，降级跳过', note.id, noteErr);
    }
  }

  return { linkProposals, reviewCards };
}

// ---- Supervisor：状态机编排 ----
// 串联 Collector → Reviewer → Writer，每步用 traceStep 记录轨迹
// Collector/Reviewer 失败则流程失败；Writer 失败则降级（双链提议保留）
export async function runMultiAgent(opts: RunAgentOptions): Promise<string> {
  const trigger = opts.trigger ?? 'manual';
  const run = await startAgentRun(trigger);
  let state: MultiAgentState = 'idle';
  let proposalsCreated = 0;

  try {
    // 阶段 1：Collector —— 收集候选笔记
    state = 'collecting';
    const collectorOutput = await traceStep(
      run.id,
      'collector',
      () => runCollector(run.id),
      (result) => ({
        candidateCount: result?.candidates.length ?? 0,
        noteCount: result?.recentNotes.length ?? 0,
      })
    );

    // Collector 空输入：0 笔记时直接返回成功，跳过后续阶段
    if (collectorOutput.recentNotes.length === 0) {
      state = 'done';
      // 记录 reviewer/writer 为 skipped，保证状态机轨迹完整
      await recordTrace(run.id, 'reviewer', 'skipped', now(), { reason: '无近期笔记' });
      await recordTrace(run.id, 'writer', 'skipped', now(), { reason: '无近期笔记' });
      await finishAgentRun(run.id, {
        notesProcessed: 0,
        proposalsCreated: 0,
        tokensUsed: { input: 0, output: 0 },
        cost: 0,
        status: 'success',
      });
      return run.id;
    }

    // 阶段 2：Reviewer —— 质量审查
    state = 'reviewing';
    const reviewerOutput = await traceStep(
      run.id,
      'reviewer',
      () => runReviewer(run.id, collectorOutput),
      (result) => ({ approvedCount: result?.approved.length ?? 0 })
    );

    // 阶段 3：Writer —— 内容产出（失败降级不中断）
    state = 'writing';
    try {
      const writerOutput = await traceStep(
        run.id,
        'writer',
        () => runWriter(run.id, reviewerOutput, opts),
        (result) => ({
          linkProposalCount: result?.linkProposals.length ?? 0,
          reviewCardCount: result?.reviewCards.length ?? 0,
        })
      );
      proposalsCreated =
        writerOutput.linkProposals.length + writerOutput.reviewCards.length;
    } catch (writerErr) {
      // Writer 整体失败：降级处理，已创建的双链提议保留
      // traceStep 已记录 writer failed，这里补充日志
      console.error('[Supervisor] Writer 失败，降级处理', writerErr);
    }

    state = 'done';
    await finishAgentRun(run.id, {
      notesProcessed: collectorOutput.recentNotes.length,
      proposalsCreated,
      tokensUsed: { input: 0, output: 0 },
      cost: 0,
      status: 'success',
    });
    return run.id;
  } catch (err) {
    // Collector/Reviewer 失败：流程失败
    state = 'failed';
    await finishAgentRun(run.id, {
      notesProcessed: 0,
      proposalsCreated,
      tokensUsed: { input: 0, output: 0 },
      cost: 0,
      status: 'failed',
      error: `[${state}] ${(err as Error).message}`,
    });
    throw err;
  }
}
