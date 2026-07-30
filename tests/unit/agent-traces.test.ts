// 单元测试：Agent 轨迹追踪
import { describe, it, expect, beforeEach } from 'vitest';
import { recordTrace, traceStep, getTracesByRun, getFailureModes } from '@/lib/db/agent-traces';
import { startAgentRun } from '@/lib/db/agent-runs';
import { getDb, _resetDbForTests } from '@/lib/db/schema';
import { now } from '@/lib/utils';

beforeEach(async () => {
  // 先清表（必须在 _resetDbForTests 之前，用现有连接清）
  try {
    const db = getDb();
    await db.agentTraces.clear();
    await db.agentRuns.clear();
  } catch {
    // 忽略
  }
  _resetDbForTests();
  // 重置后重新获取连接并清表
  try {
    const db = getDb();
    await db.agentTraces.clear();
    await db.agentRuns.clear();
  } catch {
    // 忽略
  }
});

describe('AgentTrace recordTrace', () => {
  it('成功记录一条 trace', async () => {
    const run = await startAgentRun('manual');
    const start = now();
    await recordTrace(run.id, 'load-notes', 'success', start, { noteCount: 5 });
    const traces = await getTracesByRun(run.id);
    expect(traces).toHaveLength(1);
    expect(traces[0].step).toBe('load-notes');
    expect(traces[0].status).toBe('success');
    expect(traces[0].meta?.noteCount).toBe(5);
    expect(traces[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('多条 trace 按时间排序', async () => {
    const run = await startAgentRun('manual');
    await recordTrace(run.id, 'load-notes', 'success', now());
    // 确保时间戳递增
    await new Promise((r) => setTimeout(r, 5));
    await recordTrace(run.id, 'compute-similarity', 'success', now());
    await new Promise((r) => setTimeout(r, 5));
    await recordTrace(run.id, 'create-proposal', 'success', now());

    const traces = await getTracesByRun(run.id);
    expect(traces).toHaveLength(3);
    expect(traces[0].step).toBe('load-notes');
    expect(traces[1].step).toBe('compute-similarity');
    expect(traces[2].step).toBe('create-proposal');
  });
});

describe('AgentTrace traceStep', () => {
  it('成功时记录 success', async () => {
    const run = await startAgentRun('manual');
    const result = await traceStep(
      run.id,
      'load-notes',
      async () => [1, 2, 3],
      (r) => ({ noteCount: r?.length ?? 0 })
    );
    expect(result).toEqual([1, 2, 3]);
    const traces = await getTracesByRun(run.id);
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe('success');
    expect(traces[0].meta?.noteCount).toBe(3);
  });

  it('失败时记录 failed 并抛出原始错误', async () => {
    const run = await startAgentRun('manual');
    await expect(
      traceStep(run.id, 'llm-call', async () => {
        throw new Error('LLM 超时');
      })
    ).rejects.toThrow('LLM 超时');

    const traces = await getTracesByRun(run.id);
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe('failed');
    expect(traces[0].meta?.errorType).toBe('Error');
    expect(traces[0].meta?.errorMessage).toBe('LLM 超时');
  });
});

describe('AgentTrace getFailureModes', () => {
  it('按 step + errorType 聚合失败模式', async () => {
    const run = await startAgentRun('manual');
    // 同一种失败 3 次
    await recordTrace(run.id, 'llm-call', 'failed', now(), {
      errorType: 'TimeoutError',
      errorMessage: 'LLM 超时',
    });
    await recordTrace(run.id, 'llm-call', 'failed', now(), {
      errorType: 'TimeoutError',
      errorMessage: 'LLM 超时',
    });
    await recordTrace(run.id, 'llm-call', 'failed', now(), {
      errorType: 'TimeoutError',
      errorMessage: 'LLM 超时',
    });
    // 另一种失败 1 次
    await recordTrace(run.id, 'parse-response', 'failed', now(), {
      errorType: 'SyntaxError',
      errorMessage: 'JSON 解析失败',
    });
    // 成功的不算
    await recordTrace(run.id, 'create-proposal', 'success', now());

    const modes = await getFailureModes();
    expect(modes).toHaveLength(2);
    // 按次数降序
    expect(modes[0].step).toBe('llm-call');
    expect(modes[0].errorType).toBe('TimeoutError');
    expect(modes[0].count).toBe(3);
    expect(modes[1].step).toBe('parse-response');
    expect(modes[1].count).toBe(1);
  });

  it('limit 参数生效', async () => {
    const run = await startAgentRun('manual');
    await recordTrace(run.id, 'llm-call', 'failed', now(), { errorType: 'E1' });
    await recordTrace(run.id, 'parse-response', 'failed', now(), { errorType: 'E2' });
    await recordTrace(run.id, 'create-proposal', 'failed', now(), { errorType: 'E3' });

    const modes = await getFailureModes(1);
    expect(modes).toHaveLength(1);
  });

  it('无失败时返回空数组', async () => {
    const run = await startAgentRun('manual');
    await recordTrace(run.id, 'load-notes', 'success', now());
    const modes = await getFailureModes();
    expect(modes).toHaveLength(0);
  });
});
