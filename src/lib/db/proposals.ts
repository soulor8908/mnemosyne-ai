// 提议 DAO
import { getDb } from './schema';
import type { Proposal, ProposalType, ProposalStatus, ProposalPayload } from '@/types';
import { now, idempotencyKey } from '@/lib/utils';

export async function createProposal(input: {
  type: ProposalType;
  payload: ProposalPayload;
  reason: string;
  confidence: number;
  agentRunId: string;
}): Promise<Proposal> {
  const db = getDb();

  // 幂等键去重
  const keyParts = [input.type, JSON.stringify(input.payload)];
  const id = await idempotencyKey(keyParts);

  const existing = await db.proposals.get(id);
  if (existing) return existing;

  const proposal: Proposal = {
    id,
    type: input.type,
    status: 'pending',
    payload: input.payload,
    reason: input.reason,
    confidence: input.confidence,
    createdAt: now(),
    agentRunId: input.agentRunId,
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
