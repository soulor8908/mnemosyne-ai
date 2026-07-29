// 夜间 Agent runner（技术设计文档 5.4）
import { getRecentNotes, getNotesByIds } from '@/lib/db/notes';
import { createProposal } from '@/lib/db/proposals';
import { startAgentRun, finishAgentRun } from '@/lib/db/agent-runs';
import { createBilink, findBilink } from '@/lib/db/bilinks';
import { generateReviewCard } from '@/lib/fsrs/scheduler';
import { getAllEmbeddings } from '@/lib/db/embeddings';
import { cosineSimilarity, truncate } from '@/lib/utils';
import type { Env } from '@/lib/auth/session';
import type { Note, ProposalPayload } from '@/types';

// 可注入的 LLM 调用接口：
// - 客户端调用时，传 fetch /api/chat 的实现（避免依赖 stub env.AI.run）
// - 服务端 Cron 调用时，不传，runner 内部走 callLLM(env, ...)
export interface AgentLLMCall {
  (prompt: string, opts: { system?: string; maxTokens?: number; temperature?: number }): Promise<string>;
}

export interface RunAgentOptions {
  byokKeys?: Record<string, string>;
  trigger?: 'cron' | 'manual';
  // 客户端调用时注入；服务端运行时为 undefined，runner 内部用 callLLM
  llmCall?: AgentLLMCall;
  // 服务端运行时必传；客户端运行时仅当 llmCall 缺省时才需要
  env?: Env;
}

export async function runAgent(opts: RunAgentOptions): Promise<string> {
  const trigger = opts.trigger ?? 'manual';
  const run = await startAgentRun(trigger);

  try {
    // 1. 加载近 7 日笔记
    const recentNotes = await getRecentNotes(7);
    if (recentNotes.length === 0) {
      await finishAgentRun(run.id, {
        notesProcessed: 0,
        proposalsCreated: 0,
        tokensUsed: { input: 0, output: 0 },
        cost: 0,
        status: 'success',
      });
      return run.id;
    }

    // 2. 计算语义关联（基于已有嵌入）
    const allEmbeddings = await getAllEmbeddings();
    const recentEmbeddings = allEmbeddings.filter((e) =>
      recentNotes.some((n) => n.id === e.noteId)
    );

    // 性能修复：批量预加载所有候选目标笔记到 Map，避免 O(N×M) IDB 往返
    const candidateIds = Array.from(
      new Set(allEmbeddings.map((e) => e.noteId).filter((id) => !recentNotes.some((n) => n.id === id)))
    );
    const candidateNotes = await getNotesByIds(candidateIds);
    const candidateMap = new Map<string, Note>(candidateNotes.map((n) => [n.id, n]));
    const recentMap = new Map<string, Note>(recentNotes.map((n) => [n.id, n]));

    const linkProposals: Array<{
      srcNote: Note;
      dstNote: Note;
      confidence: number;
    }> = [];

    for (const re of recentEmbeddings) {
      const srcNote = recentMap.get(re.noteId);
      if (!srcNote) continue;
      for (const oe of allEmbeddings) {
        if (oe.noteId === re.noteId) continue;
        const dstNote = candidateMap.get(oe.noteId);
        if (!dstNote || dstNote.status === 'archived') continue;
        const sim = cosineSimilarity(re.vector, oe.vector);
        if (sim >= 0.6) {
          // 检查是否已有双链
          const existing = await findBilink(srcNote.id, dstNote.id);
          if (!existing) {
            linkProposals.push({ srcNote, dstNote, confidence: sim });
          }
        }
      }
    }

    // 按置信度排序，取 top 10
    linkProposals.sort((a, b) => b.confidence - a.confidence);
    const topProposals = linkProposals.slice(0, 10);

    let proposalsCreated = 0;

    // 3. 直接创建高置信度链接提议（无需 LLM，基于向量相似度）
    for (const p of topProposals) {
      const payload: ProposalPayload = {
        srcNoteId: p.srcNote.id,
        dstNoteId: p.dstNote.id,
        confidence: p.confidence,
      };
      const reason = `《${truncate(p.srcNote.title, 30)}》与《${truncate(p.dstNote.title, 30)}》语义相似度 ${(p.confidence * 100).toFixed(0)}%，建议建立双链。`;
      await createProposal({
        type: 'link',
        payload,
        reason,
        confidence: p.confidence,
        agentRunId: run.id,
      });
      proposalsCreated++;
    }

    // 4. 调用 LLM 生成复习卡提议（如果有 BYOK 或 Trial）
    const recentSettled = recentNotes.filter((n) => n.status === 'settled').slice(0, 5);
    const llmCall = opts.llmCall ?? (async (prompt, callOpts) => {
      if (!opts.env) {
        // 既没有 llmCall 也没有 env，无法调用 LLM
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
    });

    for (const note of recentSettled) {
      try {
        const prompt = `请从以下笔记中提取 1-2 个核心知识点，生成复习卡片。每张卡片包含 front（问题）和 back（答案）。

笔记标题：${note.title}
笔记内容：
${truncate(note.content, 1500)}

请以 JSON 数组格式返回：[{"front": "问题", "back": "答案"}]，不要其他文字。`;

        const response = await llmCall(prompt, {
          system: '你是复习卡片生成助手，只返回 JSON。',
          maxTokens: 500,
          temperature: 0.3,
        });

        // 解析 JSON
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const cards = JSON.parse(jsonMatch[0]) as Array<{ front: string; back: string }>;
          for (const card of cards.slice(0, 2)) {
            const payload: ProposalPayload = {
              noteId: note.id,
              cards: [card],
            };
            await createProposal({
              type: 'review-card',
              payload,
              reason: `从《${truncate(note.title, 30)}》中提取复习卡：${truncate(card.front, 40)}`,
              confidence: 0.7,
              agentRunId: run.id,
            });
            proposalsCreated++;
          }
        }
      } catch (err) {
        // 不再静默吞掉：日志带上错误对象，便于排查
        console.error('[Agent] 生成复习卡失败', note.id, err);
      }
    }

    await finishAgentRun(run.id, {
      notesProcessed: recentNotes.length,
      proposalsCreated,
      tokensUsed: { input: 0, output: 0 },
      cost: 0,
      status: 'success',
    });

    return run.id;
  } catch (err) {
    await finishAgentRun(run.id, {
      notesProcessed: 0,
      proposalsCreated: 0,
      tokensUsed: { input: 0, output: 0 },
      cost: 0,
      status: 'failed',
      error: (err as Error).message,
    });
    throw err;
  }
}

// 应用提议（用户接受后调用）
export async function applyProposal(proposalId: string): Promise<void> {
  const { getProposal, decideProposal } = await import('@/lib/db/proposals');
  const proposal = await getProposal(proposalId);
  if (!proposal || proposal.status !== 'pending') return;

  switch (proposal.type) {
    case 'link': {
      const { srcNoteId, dstNoteId, confidence } = proposal.payload;
      if (srcNoteId && dstNoteId) {
        await createBilink({
          srcNoteId,
          dstNoteId,
          type: 'ai-accepted',
          reason: proposal.reason,
          confidence,
          createdBy: 'agent',
        });
      }
      break;
    }
    case 'review-card': {
      const { noteId, cards } = proposal.payload;
      if (noteId && cards) {
        for (const card of cards) {
          await generateReviewCard(noteId, card.front, card.back);
        }
      }
      break;
    }
    // merge/archive/trigger 暂不自动应用，仅标记
  }

  await decideProposal(proposalId, 'accepted');
}
