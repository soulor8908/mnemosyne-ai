// 单元测试：RAGAS 评估指标
import { describe, it, expect, vi } from 'vitest';
import {
  evaluateSingle,
  evaluateBatch,
  reportToMarkdown,
  parseScores,
  type RAGASInput,
} from '@/lib/ai/eval/ragas';
import type { AgentLLMCall } from '@/lib/ai/agent/runner';

// 构造 mock LLM 调用（返回固定的 JSON 分数）
function mockLLM(scores: {
  faithfulness: number;
  answerRelevancy: number;
  contextRecall: number;
  contextPrecision: number;
}): AgentLLMCall {
  return vi.fn(async () =>
    JSON.stringify(scores)
  ) as unknown as AgentLLMCall;
}

// 构造会返回乱码的 mock LLM（测试容错）
function garbageLLM(): AgentLLMCall {
  return vi.fn(async () => '这不是JSON') as unknown as AgentLLMCall;
}

const sampleInput: RAGASInput = {
  question: '什么是 SCRAM-lite？',
  answer: '一种零知识登录协议',
  contexts: ['SCRAM-lite 是服务端零知识的挑战应答登录协议'],
  groundTruth: 'SCRAM-lite 是零知识登录协议',
};

describe('RAGAS parseScores', () => {
  it('解析标准 JSON', () => {
    const result = parseScores(
      '{"faithfulness": 0.8, "answerRelevancy": 0.9, "contextRecall": 0.7, "contextPrecision": 0.85}'
    );
    expect(result.faithfulness).toBeCloseTo(0.8);
    expect(result.answerRelevancy).toBeCloseTo(0.9);
    expect(result.contextRecall).toBeCloseTo(0.7);
    expect(result.contextPrecision).toBeCloseTo(0.85);
  });

  it('解析带文字包裹的 JSON（LLM 可能加解释）', () => {
    const result = parseScores(
      '好的，评分如下：\n{"faithfulness": 0.8, "answerRelevancy": 0.9, "contextRecall": 0.7, "contextPrecision": 0.85}\n以上就是评分。'
    );
    expect(result.faithfulness).toBeCloseTo(0.8);
  });

  it('非 JSON 返回全 0', () => {
    const result = parseScores('完全不是JSON');
    expect(result.faithfulness).toBe(0);
    expect(result.answerRelevancy).toBe(0);
  });

  it('超出 [0,1] 范围的值被 clamp', () => {
    const result = parseScores(
      '{"faithfulness": 1.5, "answerRelevancy": -0.3, "contextRecall": 0.7, "contextPrecision": 0.85}'
    );
    expect(result.faithfulness).toBe(1);
    expect(result.answerRelevancy).toBe(0);
  });
});

describe('RAGAS evaluateSingle', () => {
  it('正常调用返回四个指标 + 延迟', async () => {
    const llmCall = mockLLM({
      faithfulness: 0.8,
      answerRelevancy: 0.9,
      contextRecall: 0.7,
      contextPrecision: 0.85,
    });
    const result = await evaluateSingle(sampleInput, llmCall);
    expect(result.faithfulness).toBeCloseTo(0.8);
    expect(result.answerRelevancy).toBeCloseTo(0.9);
    expect(result.contextRecall).toBeCloseTo(0.7);
    expect(result.contextPrecision).toBeCloseTo(0.85);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('LLM 返回乱码时返回全 0（不抛异常）', async () => {
    const llmCall = garbageLLM();
    const result = await evaluateSingle(sampleInput, llmCall);
    expect(result.faithfulness).toBe(0);
    expect(result.answerRelevancy).toBe(0);
    expect(result.contextRecall).toBe(0);
    expect(result.contextPrecision).toBe(0);
  });
});

describe('RAGAS evaluateBatch', () => {
  it('批量评估生成报告，统计正确', async () => {
    const llmCall = mockLLM({
      faithfulness: 0.8,
      answerRelevancy: 0.9,
      contextRecall: 0.7,
      contextPrecision: 0.85,
    });
    const samples: RAGASInput[] = [
      { ...sampleInput },
      { ...sampleInput, question: '第二个问题' },
      { ...sampleInput, question: '第三个问题' },
    ];
    const report = await evaluateBatch(samples, llmCall);
    expect(report.count).toBe(3);
    expect(report.faithfulness.mean).toBeCloseTo(0.8);
    expect(report.faithfulness.min).toBeCloseTo(0.8);
    expect(report.faithfulness.max).toBeCloseTo(0.8);
    expect(report.evalVersion).toBe('ragas-v1-ts');
    expect(report.evaluatedAt).toBeTruthy();
  });

  it('混合分数时 min/max/mean 正确', async () => {
    const scores = [
      { faithfulness: 0.6, answerRelevancy: 0.9, contextRecall: 0.5, contextPrecision: 0.8 },
      { faithfulness: 0.9, answerRelevancy: 0.7, contextRecall: 0.8, contextPrecision: 0.6 },
    ];
    let i = 0;
    const llmCall = vi.fn(async () => JSON.stringify(scores[i++])) as unknown as AgentLLMCall;
    const samples: RAGASInput[] = [
      { ...sampleInput },
      { ...sampleInput, question: '第二个' },
    ];
    const report = await evaluateBatch(samples, llmCall);
    expect(report.faithfulness.min).toBeCloseTo(0.6);
    expect(report.faithfulness.max).toBeCloseTo(0.9);
    expect(report.faithfulness.mean).toBeCloseTo(0.75);
  });

  it('单条失败不影响整体（记 0 分）', async () => {
    let i = 0;
    const llmCall = vi.fn(async () => {
      i++;
      if (i === 2) throw new Error('LLM 挂了');
      return JSON.stringify({
        faithfulness: 0.8,
        answerRelevancy: 0.9,
        contextRecall: 0.7,
        contextPrecision: 0.85,
      });
    }) as unknown as AgentLLMCall;
    const samples: RAGASInput[] = [
      { ...sampleInput },
      { ...sampleInput, question: '会失败的一条' },
      { ...sampleInput, question: '第三条' },
    ];
    const report = await evaluateBatch(samples, llmCall);
    expect(report.count).toBe(3);
    // 失败那条 faithfulness=0，拉低均值
    expect(report.faithfulness.mean).toBeCloseTo((0.8 + 0 + 0.8) / 3, 2);
  });
});

describe('RAGAS reportToMarkdown', () => {
  it('生成合法 Markdown，含指标表格', async () => {
    const llmCall = mockLLM({
      faithfulness: 0.8,
      answerRelevancy: 0.9,
      contextRecall: 0.7,
      contextPrecision: 0.85,
    });
    const report = await evaluateBatch([sampleInput], llmCall);
    const md = reportToMarkdown(report);
    expect(md).toContain('# RAGAS 评估报告');
    expect(md).toContain('faithfulness');
    expect(md).toContain('0.800');
    expect(md).toContain('ragas-v1-ts');
    expect(md).toContain('样本数');
  });
});
