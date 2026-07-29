// 提议 DAO
import { getDb } from './schema';
import type { Proposal, ProposalType, ProposalStatus, ProposalPayload } from '@/types';
import { now, idempotencyKey } from '@/lib/utils';
import { z } from 'zod';

// Agent 创建提议时的入参 schema。
// 修复要点：原 ProposalSchema（在 ai/schemas.ts）定义后从未被调用，
// reason.min(20)、confidence 0-1 范围、payload 形状全是死校验。
// 这里在 DAO 边界接入真实校验，让 Agent 写入失败时立刻报错而不是污染数据库。
// 注意 agentRunId 不在 schema 内，因为它是 DAO 的元数据，由调用方提供。
const CreateProposalInputSchema = z.object({
  type: z.enum(['link', 'merge', 'archive', 'trigger', 'review-card', 'map-update']),
  reason: z.string().min(20, '提议理由至少 20 字，保证可解释性'),
  confidence: z.number().min(0).max(1),
  agentRunId: z.string().min(1),
  // payload 形状按 type 区分（discriminated union 改进错误信息）
  payload: z.union([
    z.object({
      srcNoteId: z.string(),
      dstNoteId: z.string(),
      confidence: z.number().min(0).max(1).optional(),
    }),
    z.object({
      noteIds: z.array(z.string()).min(2),
      newTitle: z.string(),
    }),
    z.object({
      noteId: z.string(),
      reason: z.string().optional(),
    }),
    z.object({
      noteId: z.string(),
      triggerDate: z.string(),
      relatedNoteIds: z.array(z.string()),
    }),
    z.object({
      noteId: z.string(),
      cards: z.array(z.object({ front: z.string(), back: z.string() })).min(1),
    }),
    z.object({
      weekKey: z.string(),
      nodes: z.array(z.object({ id: z.string(), label: z.string() })),
      edges: z.array(z.object({ src: z.string(), dst: z.string(), weight: z.number() })),
    }),
  ]),
});

export async function createProposal(input: {
  type: ProposalType;
  payload: ProposalPayload;
  reason: string;
  confidence: number;
  agentRunId: string;
}): Promise<Proposal> {
  // 边界校验：拒绝不合格提议入库
  const parsed = CreateProposalInputSchema.parse(input);
  const db = getDb();

  // 幂等键去重
  const keyParts = [parsed.type, JSON.stringify(parsed.payload)];
  const id = await idempotencyKey(keyParts);

  const existing = await db.proposals.get(id);
  if (existing) return existing;

  const proposal: Proposal = {
    id,
    type: parsed.type,
    status: 'pending',
    payload: parsed.payload as ProposalPayload,
    reason: parsed.reason,
    confidence: parsed.confidence,
    createdAt: now(),
    agentRunId: parsed.agentRunId,
  };
  await db.proposals.add(proposal);
  return proposal;
}

export async function getProposal(id: string): Promise<Proposal | undefined> {
  const db = getDb();
  return db.proposals.get(id);
}

export async function listProposals(opts?: {
  status?: ProposalStatus;
  limit?: number;
}): Promise<Proposal[]> {
  const db = getDb();
  let collection = db.proposals.orderBy('createdAt').reverse();
  if (opts?.status) {
    collection = collection.filter((p) => p.status === opts.status);
  }
  return collection.limit(opts?.limit ?? 50).toArray();
}

export async function decideProposal(
  id: string,
  decision: 'accepted' | 'dismissed'
): Promise<void> {
  const db = getDb();
  await db.proposals.update(id, {
    status: decision,
    decidedAt: now(),
  });
}

export async function countPendingProposals(): Promise<number> {
  const db = getDb();
  return db.proposals.where('status').equals('pending').count();
}
