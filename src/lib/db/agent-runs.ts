// Agent 运行记录 DAO
import { getDb } from './schema';
import type { AgentRun, AgentRunTrigger, AgentRunStatus } from '@/types';
import { genId, now } from '@/lib/utils';

export async function startAgentRun(trigger: AgentRunTrigger): Promise<AgentRun> {
  const db = getDb();
  const run: AgentRun = {
    id: genId('run'),
    startedAt: now(),
    trigger,
    notesProcessed: 0,
    proposalsCreated: 0,
    tokensUsed: { input: 0, output: 0 },
    cost: 0,
    status: 'running',
  };
  await db.agentRuns.add(run);
  return run;
}

export async function finishAgentRun(
  id: string,
  result: {
    notesProcessed: number;
    proposalsCreated: number;
    tokensUsed: { input: number; output: number };
    cost: number;
    status: AgentRunStatus;
    error?: string;
  }
): Promise<void> {
  const db = getDb();
  await db.agentRuns.update(id, {
    finishedAt: now(),
    ...result,
  });
}

export async function getLatestAgentRun(): Promise<AgentRun | undefined> {
  const db = getDb();
  const runs = await db.agentRuns.orderBy('startedAt').reverse().limit(1).toArray();
  return runs[0];
}
