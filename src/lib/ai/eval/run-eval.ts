// RAGAS 评估运行器
//
// 把测试集 + hybridSearch + /api/chat + evaluateSingle 串起来：
//   1. 遍历测试集每条样本
//   2. 用 hybridSearch 检索 top-K 笔记作为 contexts
//   3. 用 llmCall（注入的 LLM）基于 contexts 生成 answer
//   4. 用 evaluateSingle 对 (question, answer, contexts, groundTruth) 打分
//   5. 汇总成 RAGASReport，可选输出 Markdown
//
// 设计为纯逻辑 + 依赖注入：
//   - hybridSearch 在客户端跑（访问 IndexedDB）
//   - llmCall 由调用方注入（客户端走 /api/chat，测试走 mock）
//   - 因此本模块可在浏览器和 Node 测试环境运行
import { hybridSearch } from '@/lib/ai/search';
import { evaluateBatch, reportToMarkdown, type RAGASInput, type RAGASReport } from './ragas';
import { TEST_SET, type EvalSample } from './test-set';
import type { AgentLLMCall } from '@/lib/ai/agent/runner';

export interface RunEvalOptions {
  // 注入的 LLM 调用（用于生成 answer 和打分，可以是同一个）
  llmCall: AgentLLMCall;
  // 检索 top-K，默认 5
  topK?: number;
  // 只跑指定类别的样本（调试用）
  categoryFilter?: EvalSample['category'];
  // 进度回调
  onProgress?: (done: number, total: number, sample: EvalSample) => void;
}

export interface RunEvalResult {
  report: RAGASReport;
  markdown: string;
}

// 把检索结果 + LLM 问答组装成 RAGASInput
async function buildRAGASInput(
  sample: EvalSample,
  llmCall: AgentLLMCall,
  topK: number
): Promise<RAGASInput> {
  // 1. 检索
  const searchResults = await hybridSearch(sample.question, topK);
  const contexts = searchResults.map(
    (r) => `标题：${r.note.title}\n内容：${r.note.content.slice(0, 500)}`
  );

  // 2. 生成 answer（基于 contexts 问答，无上下文则拒答）
  let answer: string;
  if (contexts.length === 0) {
    answer = '知识库中没有相关内容，无法回答。';
  } else {
    const contextText = contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n');
    const prompt = `基于以下笔记上下文回答问题。逐条用 [n] 标注出处。无相关内容时诚实拒答。

## 上下文
${contextText}

## 问题
${sample.question}`;

    answer = await llmCall(prompt, {
      system: '你是知识库助手，只依据上下文回答，无相关内容时拒答。',
      maxTokens: 500,
      temperature: 0.3,
    });
  }

  return {
    question: sample.question,
    answer,
    contexts,
    groundTruth: sample.groundTruth,
  };
}

// 主入口：跑完整评估
export async function runEval(opts: RunEvalOptions): Promise<RunEvalResult> {
  const { llmCall, topK = 5, categoryFilter, onProgress } = opts;

  const samples = categoryFilter
    ? TEST_SET.filter((s) => s.category === categoryFilter)
    : TEST_SET;

  const ragasInputs: RAGASInput[] = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    onProgress?.(i, samples.length, sample);
    try {
      const input = await buildRAGASInput(sample, llmCall, topK);
      ragasInputs.push(input);
    } catch (err) {
      console.error('[eval] 构建样本失败', sample.id, err);
      ragasInputs.push({
        question: sample.question,
        answer: '（评估失败）',
        contexts: [],
        groundTruth: sample.groundTruth,
      });
    }
  }
  onProgress?.(samples.length, samples.length, samples[samples.length - 1]);

  // 批量打分
  const report = await evaluateBatch(ragasInputs, llmCall);
  const markdown = reportToMarkdown(report);

  return { report, markdown };
}

// 把 Markdown 报告写到文件（Node 环境用）
export async function saveReport(markdown: string, path: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.writeFile(path, markdown, 'utf-8');
}

export { TEST_SET, TEST_SET_STATS } from './test-set';
export { evaluateSingle, evaluateBatch, reportToMarkdown, type RAGASInput, type RAGASOutput, type RAGASReport } from './ragas';
