# RAGAS 实战：给 RAG 系统装上仪表盘

> 做了 RAG 系统的人都会遇到同一个问题：**"我的 RAG 效果到底怎么样？"**——检索准不准、答案有没有幻觉、换了个 chunking 策略是变好了还是变差了，全凭感觉。
>
> 这篇文章讲我用 TypeScript 实现 RAGAS（RAG Assessment）评估体系的过程：4 个核心指标、35 条测试集、LLM-as-Judge 打分、回归基线。不依赖 Python，不需要额外服务，直接嵌在应用里。
>
> 这是 [Mnemosyne](https://github.com/soulor8908/mnemosyne-ai) 系列第四篇。前三篇：[零信任架构](./01-local-first-zerotrust-architecture.md) / [MCP Server](./02-mcp-server-from-scratch.md) / [混合检索 bug 复盘](./03-hybrid-search-dimension-mismatch-bug.md)。

## 一、为什么需要 RAGAS

没有评估体系的 RAG 系统是这样的：

```
用户：搜一下"SCRAM-lite 怎么工作"
系统：[返回 5 条笔记，用户不知道准不准]
开发者：我加了重排，应该变好了吧？
用户：感觉不如以前准了...
开发者：？？？
```

加了 RAGAS 后：

```
开发者：改了重排策略，跑一次评估
  faithfulness: 0.72 → 0.82  ✓（幻觉减少）
  contextRecall: 0.68 → 0.61  ✗（召回率下降）
开发者：重排太激进，丢了相关上下文。调 top_k=20→30
  contextRecall: 0.61 → 0.79  ✓
  faithfulness: 0.82 → 0.80   ✓（基本不变）
开发者：锁定这个配置
```

**评估体系把"凭感觉"变成"看数字"**。这是 junior 和 senior 的分水岭——JD 原话："建立测试集和评测指标"。

## 二、RAGAS 的 4 个核心指标

RAGAS 论文（[arXiv:2309.15217](https://arxiv.org/abs/2309.15217)）定义了 4 个指标，我用白话解释：

| 指标 | 问什么 | 0 分 | 1 分 |
|---|---|---|---|
| **faithfulness**（忠实度） | 答案是不是编的？ | 全是幻觉 | 完全来自上下文 |
| **answerRelevancy**（答案相关性） | 答案回答了问题吗？ | 完全跑题 | 完全切题 |
| **contextRecall**（上下文召回率） | 该检索到的都检索到了吗？ | 标准答案的信息一个没检索到 | 全部检索到 |
| **contextPrecision**（上下文精确率） | 检索到的都相关吗？ | 全是噪音 | 全相关 |

**关键理解**：
- `faithfulness` 管"不胡说"
- `answerRelevancy` 管"答非所问"
- `contextRecall` 管"漏召回"（需要 groundTruth）
- `contextPrecision` 管"噪音多"

四个指标互补，单独看一个会误导。比如只看 faithfulness 高分——可能因为检索到的上下文太少，答案短就没机会幻觉，但 contextRecall 会很低。

## 三、为什么用 TS 实现而不用 Python RAGAS 库

原版 RAGAS 是 Python 库，依赖 LangChain。我选择用 TS 重新实现，原因：

1. **嵌入应用而非独立脚本**——评估要能从 UI 一键触发，不能是外部 Python 进程
2. **降低部署复杂度**——local-first 应用不该要求用户装 Python
3. **LLM-as-Judge 简化版够用**——原版 RAGAS 用多步 LLM 拆解命题，成本高；我简化为单次 LLM 打分，精度略低但够做回归基线
4. **可控性**——自己实现能精确控制 prompt 和打分逻辑

**取舍**：简化版精度不如原版（原版 faithfulness 会把答案拆成命题逐条验证，我是一次性让 LLM 打分）。但作为回归基线，**关注的是相对变化（0.72→0.82）而非绝对精度**，简化版完全够用。

## 四、实现：LLM-as-Judge 打分

核心是 `evaluateSingle` 函数——把 (question, answer, contexts, groundTruth) 喂给 LLM，让它返回 4 个 0-1 的分数。

```typescript
// src/lib/ai/eval/ragas.ts
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
1. faithfulness（忠实度）：答案是否完全来自上下文，无幻觉。0=全是幻觉，1=完全忠实。
2. answerRelevancy（答案相关性）：0=完全跑题，1=完全切题。
3. contextRecall：${input.groundTruth ? '标准答案所需信息是否被上下文覆盖。0=没覆盖，1=全覆盖。' : '无标准答案时固定 0.5。'}
4. contextPrecision：检索到的上下文是否都相关。0=全无关，1=全相关。

只输出 JSON：
{"faithfulness": 0.0, "answerRelevancy": 0.0, "contextRecall": 0.0, "contextPrecision": 0.0}`;

  const response = await llmCall(prompt, {
    system: '你是 RAG 评估员，只返回 JSON。',
    maxTokens: 200,
    temperature: 0,  // 打分要确定性
  });

  const scores = parseScores(response);
  return { ...scores, latencyMs: Date.now() - start };
}
```

### 4.1 temperature=0 的意义

打分时 `temperature: 0`——同一个输入每次打分应该一样。否则评估结果不稳定，无法做回归对比。

### 4.2 容错解析

LLM 可能返回带解释的 JSON（"好的，评分如下：{...}"），所以解析要容错：

```typescript
export function parseScores(raw: string): Omit<RAGASOutput, 'latencyMs'> {
  const match = raw.match(/\{[\s\S]*\}/);  // 提取第一个 JSON 对象
  if (!match) {
    return { faithfulness: 0, answerRelevancy: 0, contextRecall: 0, contextPrecision: 0 };
  }
  try {
    const obj = JSON.parse(match[0]);
    const clamp = (v: unknown) => {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (isNaN(n)) return 0;
      return Math.max(0, Math.min(1, n));  // 强制 [0,1]
    };
    return {
      faithfulness: clamp(obj.faithfulness),
      answerRelevancy: clamp(obj.answerRelevancy),
      contextRecall: clamp(obj.contextRecall),
      contextPrecision: clamp(obj.contextPrecision),
    };
  } catch {
    return { faithfulness: 0, answerRelevancy: 0, contextRecall: 0, contextPrecision: 0 };
  }
}
```

两个防御点：
1. **正则提取**——容忍 LLM 在 JSON 前后加文字
2. **clamp [0,1]**——LLM 可能返回 1.5 或 -0.3，强制截断到合法范围

### 4.3 失败不抛异常

LLM 返回乱码时返回全 0 而非抛异常——因为这是评估，不是业务逻辑。全 0 会拉低均值，**反而让失败可见**（faithfulness 突然掉到 0，说明评估本身有问题）。

## 五、测试集设计：35 条覆盖 4 类场景

测试集是评估的核心。我设计了 35 条问答，覆盖 4 类场景：

```typescript
export const TEST_SET_STATS = {
  total: 35,
  factual: 10,      // 事实型：单笔记可答
  synthesis: 10,    // 综合型：需跨笔记关联
  'no-answer': 10,  // 无答案：应拒答
  'cross-time': 5,  // 跨时间关联
};
```

### 5.1 为什么要分这 4 类

| 类别 | 测什么 | 典型样本 |
|---|---|---|
| factual | 基础召回 | "SCRAM-lite 的三个派生量是什么？" |
| synthesis | 跨笔记推理 | "零信任登录和加密同步怎么配合？" |
| no-answer | 拒答能力 | "Mnemosyne 收费吗？"（知识库无此信息） |
| cross-time | 时序关联 | "我之前写的登录和后来的 MCP 有什么共同理念？" |

**no-answer 类最容易被忽略**——很多 RAG 系统对"没有相关内容"的问题硬编答案（幻觉）。这类样本的 groundTruth 是"应拒答"，faithfulness 会很低如果系统硬答了。

### 5.2 hard case 的价值

测试集里故意放了 hard case：
- "cosineSimilarity 维度不匹配时返回什么？"——答案是个数字（0），LLM 容易答成"报错"
- "我修复维度 bug 和修复助记词校验的思路有什么共同点？"——需要跨两篇笔记综合

**easy case 让指标好看，hard case 才能发现问题**。

## 六、评估运行器：串起检索 + 问答 + 打分

`runEval` 把完整链路串起来：

```typescript
export async function runEval(opts: RunEvalOptions): Promise<RunEvalResult> {
  const samples = categoryFilter
    ? TEST_SET.filter((s) => s.category === categoryFilter)
    : TEST_SET;

  const ragasInputs: RAGASInput[] = [];

  for (const sample of samples) {
    // 1. 用 hybridSearch 检索
    const searchResults = await hybridSearch(sample.question, topK);
    const contexts = searchResults.map(
      (r) => `标题：${r.note.title}\n内容：${r.note.content.slice(0, 500)}`
    );

    // 2. 用 LLM 基于上下文生成答案（无上下文则拒答）
    let answer: string;
    if (contexts.length === 0) {
      answer = '知识库中没有相关内容，无法回答。';
    } else {
      answer = await llmCall(prompt, { /* ... */ });
    }

    ragasInputs.push({
      question: sample.question,
      answer,
      contexts,
      groundTruth: sample.groundTruth,
    });
  }

  // 3. 批量打分
  const report = await evaluateBatch(ragasInputs, llmCall);
  return { report, markdown: reportToMarkdown(report) };
}
```

### 6.1 无上下文时诚实拒答

```typescript
if (contexts.length === 0) {
  answer = '知识库中没有相关内容，无法回答。';
}
```

这行很重要——no-answer 类样本应该走这里。如果检索器对"收费吗"这种问题也返回了笔记，说明检索精确率低，contextPrecision 会扣分。

### 6.2 上下文截断省 token

```typescript
const contexts = searchResults.map(
  (r) => `标题：${r.note.title}\n内容：${r.note.content.slice(0, 500)}`
);
```

每条笔记只取前 500 字符作为上下文。**评估时给 LLM 的上下文要和实际生产一致**——如果生产用 500 字，评估也用 500 字，否则评估结果不能反映真实效果。

## 七、报告输出：Markdown 表格做版本对比

```typescript
export function reportToMarkdown(report: RAGASReport): string {
  return `# RAGAS 评估报告
- 评估版本: ${report.evalVersion}
- 样本数: ${report.count}
- 评估耗时: mean=${report.latencyMs.mean}ms p95=${report.latencyMs.p95}ms

| 指标 | 均值 | 最小值 | 最大值 |
|---|---|---|---|
| faithfulness | ${report.faithfulness.mean} | ... | ... |
| ...`;
}
```

报告 commit 到仓库，每次改检索策略后跑一次，`git diff` 就能看变化：

```bash
git diff docs/eval/baseline.md docs/eval/after-rerank.md
# faithfulness: 0.72 → 0.82
# contextRecall: 0.68 → 0.61
```

**这就是"RAG 系统的仪表盘"**——不再凭感觉，而是看数字决策。

## 八、踩过的坑

### 坑 1：失败样本不该被过滤掉

最初 `buildReport` 的统计函数过滤了 0 分：

```typescript
// 错误版本
const vals = results.map((r) => r.scores[key]).filter((v) => v > 0);
```

这导致 LLM 评估失败的样本（返回全 0）被排除，**均值虚高**。测试发现"单条失败时均值还是 0.8"——明显错误。

修复：不过滤 0 分，失败样本参与均值计算，拉低指标反映真实质量：

```typescript
// 正确版本
const vals = results.map((r) => r.scores[key]);  // 不过滤
```

**教训**：评估体系的统计逻辑要测，不能想当然。

### 坑 2：LLM 打分的不稳定性

同一个输入，`temperature: 0` 下大部分 LLM 会返回稳定分数，但偶尔会差 0.1-0.2。解决方案：
- 多次评估取平均（成本高）
- 或接受 ±0.05 的波动，**只关注 >0.1 的变化**

工程上选后者——回归基线关注的是显著变化，不是小数点后两位的精度。

### 坑 3：contextRecall 需要 groundTruth

4 个指标里只有 contextRecall 严格需要 groundTruth（标准答案）。没有 groundTruth 时我让它返回固定 0.5：

```typescript
3. contextRecall：${input.groundTruth ? '标准答案所需信息是否被上下文覆盖' : '无标准答案时固定 0.5'}
```

**为什么是 0.5 而非 0？** 0 会拉低均值误导人，0.5 表示"中性/未知"。报告里要看 contextRecall 的均值时，得知道有多少样本是真评估、多少是 0.5 占位。

## 九、与 Cross-Encoder 重排的配合

RAGAS 最大的价值是**衡量改进效果**。我加了 Cross-Encoder 重排后（见 [services/rerank/](https://github.com/soulor8908/mnemosyne-ai/tree/main/services/rerank)），用 RAGAS 验证：

```
改进前（纯 RRF 融合，top-5）：
  faithfulness: 0.72
  contextPrecision: 0.65

改进后（RRF top-20 → Cross-Encoder 重排 top-5）：
  faithfulness: 0.82  (+0.10)
  contextPrecision: 0.81  (+0.16)
  contextRecall: 0.79  (+0.11，因为 top-20 召回更广)
  latencyMs: +800ms     (重排代价)
```

**数字说话**：重排让精确率和忠实度显著提升，召回率也涨了（因为候选池从 5 扩到 20），代价是 +800ms 延迟。值不值？看指标决定。

## 十、总结：RAGAS 的工程价值

### 做对的事

1. **LLM-as-Judge 简化版**——单次打分而非多步拆解，成本低，够做回归
2. **35 条测试集覆盖 4 类场景**——含 no-answer 和 hard case
3. **失败样本不过滤**——全 0 参与均值，反映真实质量
4. **Markdown 报告做版本对比**——git diff 看变化
5. **temperature=0**——打分要确定性

### 局限性

1. **LLM 打分有 ±0.05 波动**——只关注 >0.1 的变化
2. **简化版精度不如原版 RAGAS**——但回归基线看相对变化，够用
3. **测试集只有 35 条**——覆盖面有限，后续要扩充到 100+
4. **contextRecall 依赖 groundTruth**——无标注样本只能给 0.5

### 面试价值

这套东西直接命中 JD 高频考点：
- "怎么评估 RAG 效果？" → 4 指标 + LLM-as-Judge
- "怎么建测试集？" → 4 类场景 + hard case
- "改了策略怎么验证？" → git diff 报告对比
- "评估体系有什么坑？" → 失败样本过滤 / 打分不稳定 / groundTruth 依赖

**"我给 RAG 系统加了评估仪表盘"** 这句话，比"我用过 RAG"值钱十倍。

---

**项目地址**：[github.com/soulor8908/mnemosyne-ai](https://github.com/soulor8908/mnemosyne-ai)
**相关代码**：
- [src/lib/ai/eval/ragas.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/ai/eval/ragas.ts) — 4 指标 + LLM-as-Judge
- [src/lib/ai/eval/test-set.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/ai/eval/test-set.ts) — 35 条测试集
- [src/lib/ai/eval/run-eval.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/ai/eval/run-eval.ts) — 评估运行器
- [tests/unit/ragas.test.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/tests/unit/ragas.test.ts) — 10 个测试

**上一篇**：[《混合检索的坑：维度不匹配 bug 复盘》](./03-hybrid-search-dimension-mismatch-bug.md)
