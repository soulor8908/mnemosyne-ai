// RAGAS 评估指标（LLM-as-Judge 实现）
//
// 参考 RAGAS 论文（https://arxiv.org/abs/2309.15217）的四个核心指标，
// 用 LLM 做评估打分，不依赖 Python 环境。
//
// 四个指标：
//   - faithfulness（忠实度）：答案是否忠实于上下文，无幻觉
//   - answer_relevancy（答案相关性）：答案是否回答了问题
//   - context_recall（上下文召回率）：所需上下文是否都被检索到
//   - context_precision（上下文精确率）：检索到的上下文是否都相关
//
// 设计取舍：原版 RAGAS 用多步 LLM 调用拆解命题，这里简化为单次 LLM 打分
// （0-1 浮点），降低成本。精度略低但够用作回归基线。
import type { AgentLLMCall } from '@/lib/ai/agent/runner';

export interface RAGASInput {
  question: string;
  answer: string;
  contexts: string[]; // 检索到的上下文片段
  groundTruth?: string; // 标准答案（context_recall 需要）
}

export interface RAGASOutput {
  faithfulness: number;      // 0-1，答案对上下文的忠实度
  answerRelevancy: number;   // 0-1，答案对问题的相关性
  contextRecall: number;     // 0-1，上下文召回率（需 groundTruth）
  contextPrecision: number;  // 0-1，上下文精确率
  // 单条评估耗时（毫秒），用于性能回归
  latencyMs: number;
}

export interface RAGASResult {
  // 单条评估结果
  sample: RAGASInput;
  scores: RAGASOutput;
}

export interface RAGASReport {
  // 批量评估汇总
  count: number;
  faithfulness: { mean: number; min: number; max: number };
  answerRelevancy: { mean: number; min: number; max: number };
  contextRecall: { mean: number; min: number; max: number };
  contextPrecision: { mean: number; min: number; max: number };
  latencyMs: { mean: number; p95: number };
  results: RAGASResult[];
  // 评估版本，用于回归对比
  evalVersion: string;
  // 评估时间戳
  evaluatedAt: string;
}

const EVAL_VERSION = 'ragas-v1-ts';

// 用 LLM 对单条样本打分，返回 0-1 的四个指标
export async function evaluateSingle(
  input: RAGASInput,
  llmCall: AgentLLMCall
): Promise<RAGASOutput> {
  const start = Date.now();

  const contextText = input.contexts
    .map((c, i) => `[${i + 1}] ${c}`)
    .join('\n\n');

  const prompt = `你是一个 RAG 系统的评估员。请对以下问答对打分，输出 JSON。

## 问题
${input.question}

## 检索到的上下文
${contextText || '（无上下文）'}

## 系统答案
${input.answer}
${input.groundTruth ? `\n## 标准答案（参考）\n${input.groundTruth}` : ''}

请按 RAGAS 四个指标打分（0.0 到 1.0，保留两位小数）：

1. faithfulness（忠实度）：答案是否完全来自上下文，无幻觉、无编造。0=全是幻觉，1=完全忠实。
2. answerRelevancy（答案相关性）：答案是否切题回答了问题。0=完全跑题，1=完全切题。
3. contextRecall（上下文召回率）：${input.groundTruth ? '标准答案所需的信息是否都被上下文覆盖。0=完全没覆盖，1=完全覆盖。' : '无标准答案时，此项固定 0.5（无法评估）。'}
4. contextPrecision（上下文精确率）：检索到的上下文是否都与问题相关。0=全无关，1=全相关。

只输出 JSON，不要解释：
{"faithfulness": 0.0, "answerRelevancy": 0.0, "contextRecall": 0.0, "contextPrecision": 0.0}`;

  const response = await llmCall(prompt, {
    system: '你是 RAG 评估员，只返回 JSON。',
    maxTokens: 200,
    temperature: 0,
  });

  // 解析 LLM 输出的 JSON
  const scores = parseScores(response);

  return {
    ...scores,
    latencyMs: Date.now() - start,
  };
}

// 解析 LLM 输出的分数（容错：提取第一个 JSON 对象）
export function parseScores(raw: string): Omit<RAGASOutput, 'latencyMs'> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      faithfulness: 0,
      answerRelevancy: 0,
      contextRecall: 0,
      contextPrecision: 0,
    };
  }
  try {
    const obj = JSON.parse(match[0]);
    const clamp = (v: unknown) => {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (isNaN(n)) return 0;
      return Math.max(0, Math.min(1, n));
    };
    return {
      faithfulness: clamp(obj.faithfulness),
      answerRelevancy: clamp(obj.answerRelevancy),
      contextRecall: clamp(obj.contextRecall),
      contextPrecision: clamp(obj.contextPrecision),
    };
  } catch {
    return {
      faithfulness: 0,
      answerRelevancy: 0,
      contextRecall: 0,
      contextPrecision: 0,
    };
  }
}

// 批量评估并生成报告
export async function evaluateBatch(
  samples: RAGASInput[],
  llmCall: AgentLLMCall
): Promise<RAGASReport> {
  const results: RAGASResult[] = [];

  for (const sample of samples) {
    try {
      const scores = await evaluateSingle(sample, llmCall);
      results.push({ sample, scores });
    } catch (err) {
      // 单条失败不影响整体，记 0 分
      console.error('[ragas] 评估失败', sample.question, err);
      results.push({
        sample,
        scores: {
          faithfulness: 0,
          answerRelevancy: 0,
          contextRecall: 0,
          contextPrecision: 0,
          latencyMs: 0,
        },
      });
    }
  }

  return buildReport(results);
}

// 汇总统计
function buildReport(results: RAGASResult[]): RAGASReport {
  const stats = (key: keyof RAGASOutput) => {
    // 不过滤 0 分——失败样本应参与均值计算，拉低指标反映真实质量
    const vals = results.map((r) => r.scores[key] as number);
    if (vals.length === 0) return { mean: 0, min: 0, max: 0 };
    return {
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
    };
  };

  const latencies = results.map((r) => r.scores.latencyMs).sort((a, b) => a - b);
  const p95Idx = Math.floor(latencies.length * 0.95);

  return {
    count: results.length,
    faithfulness: stats('faithfulness'),
    answerRelevancy: stats('answerRelevancy'),
    contextRecall: stats('contextRecall'),
    contextPrecision: stats('contextPrecision'),
    latencyMs: {
      mean: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
      p95: latencies[p95Idx] ?? 0,
    },
    results,
    evalVersion: EVAL_VERSION,
    evaluatedAt: new Date().toISOString(),
  };
}

// 将报告格式化为 Markdown（便于 commit 到仓库做回归对比）
export function reportToMarkdown(report: RAGASReport): string {
  return `# RAGAS 评估报告

- **评估版本**: ${report.evalVersion}
- **评估时间**: ${report.evaluatedAt}
- **样本数**: ${report.count}
- **评估耗时**: mean=${report.latencyMs.mean.toFixed(0)}ms p95=${report.latencyMs.p95.toFixed(0)}ms

## 指标汇总

| 指标 | 均值 | 最小值 | 最大值 |
|---|---|---|---|
| faithfulness（忠实度） | ${report.faithfulness.mean.toFixed(3)} | ${report.faithfulness.min.toFixed(3)} | ${report.faithfulness.max.toFixed(3)} |
| answerRelevancy（答案相关性） | ${report.answerRelevancy.mean.toFixed(3)} | ${report.answerRelevancy.min.toFixed(3)} | ${report.answerRelevancy.max.toFixed(3)} |
| contextRecall（上下文召回率） | ${report.contextRecall.mean.toFixed(3)} | ${report.contextRecall.min.toFixed(3)} | ${report.contextRecall.max.toFixed(3)} |
| contextPrecision（上下文精确率） | ${report.contextPrecision.mean.toFixed(3)} | ${report.contextPrecision.min.toFixed(3)} | ${report.contextPrecision.max.toFixed(3)} |

## 单条明细

| # | question | faithfulness | answerRelevancy | contextRecall | contextPrecision | latencyMs |
|---|---|---|---|---|---|---|
${report.results
  .map(
    (r, i) =>
      `| ${i + 1} | ${r.sample.question.slice(0, 30)}… | ${r.scores.faithfulness.toFixed(2)} | ${r.scores.answerRelevancy.toFixed(2)} | ${r.scores.contextRecall.toFixed(2)} | ${r.scores.contextPrecision.toFixed(2)} | ${r.scores.latencyMs} |`
  )
  .join('\n')}
`;
}

export { EVAL_VERSION };
