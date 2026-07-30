// Agent 轨迹追踪 DAO
//
// trace 写入是"尽力而为"——失败不影响主流程（只打日志），
// 因为可观测性不能反噬业务可用性。
import { getDb } from './schema';
import { genId, now } from '@/lib/utils';
import type { AgentTrace, AgentStepType, AgentStepStatus } from '@/types';

// 写入一条 trace（best-effort，失败只打日志）
export async function recordTrace(
  runId: string,
  step: AgentStepType,
  status: AgentStepStatus,
  startedAt: number,
  meta?: AgentTrace['meta']
): Promise<void> {
  try {
    const db = getDb();
    const trace: AgentTrace = {
      id: genId('trace'),
      runId,
      step,
      status,
      startedAt,
      durationMs: now() - startedAt,
      meta,
    };
    await db.agentTraces.add(trace);
  } catch (err) {
    // 可观测性不能反噬业务
    console.error('[agent-trace] 记录失败', step, err);
  }
}

// 记录一个 step 的执行（高阶函数，自动计时）
export async function traceStep<T>(
  runId: string,
  step: AgentStepType,
  fn: () => Promise<T>,
  metaFactory?: (result: T | null, error: Error | null) => AgentTrace['meta']
): Promise<T> {
  const startedAt = now();
  try {
    const result = await fn();
    const meta = metaFactory?.(result, null);
    await recordTrace(runId, step, 'success', startedAt, meta);
    return result;
  } catch (err) {
    const error = err as Error;
    const meta = metaFactory?.(null, error);
    await recordTrace(runId, step, 'failed', startedAt, {
      ...meta,
      errorType: error.name,
      errorMessage: error.message,
    });
    throw err;
  }
}

// 按 runId 查询某次运行的完整轨迹
export async function getTracesByRun(runId: string): Promise<AgentTrace[]> {
  const db = getDb();
  return db.agentTraces
    .where('runId')
    .equals(runId)
    .sortBy('startedAt');
}

// 失败模式统计：按 step + errorType 聚合
export interface FailureModeStat {
  step: AgentStepType;
  errorType: string;
  count: number;
  lastErrorMessage: string;
  lastOccurredAt: number;
}

export async function getFailureModes(limit = 20): Promise<FailureModeStat[]> {
  const db = getDb();
  const failedTraces = await db.agentTraces
    .where('status')
    .equals('failed')
    .toArray();

  // 按 step + errorType 聚合
  const map = new Map<string, FailureModeStat>();
  for (const t of failedTraces) {
    const key = `${t.step}|${t.meta?.errorType ?? 'Unknown'}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      if (t.startedAt > existing.lastOccurredAt) {
        existing.lastOccurredAt = t.startedAt;
        existing.lastErrorMessage = t.meta?.errorMessage ?? '';
      }
    } else {
      map.set(key, {
        step: t.step,
        errorType: t.meta?.errorType ?? 'Unknown',
        count: 1,
        lastErrorMessage: t.meta?.errorMessage ?? '',
        lastOccurredAt: t.startedAt,
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
