# Agent 失败模式分析报告

> 基于 [Mnemosyne](https://github.com/soulor8908/mnemosyne-ai) 夜间 Agent 的轨迹追踪数据（`agentTraces` 表），按 step × errorType 聚合出的失败模式 Top N。
>
> 这份报告的目的是把"Agent 偶尔出问题"变成"可量化、可追踪、可优化"的工程问题——面试时被问"你 Agent 踩过什么坑"，这份报告就是答案。

## 一、可观测性架构

### 1.1 数据模型

每次 `runAgent` 执行时，关键步骤都会写一条 `AgentTrace` 记录：

```typescript
interface AgentTrace {
  id: string;
  runId: string;            // 关联哪次 run
  step: AgentStepType;      // 哪个步骤
  status: 'success' | 'failed' | 'skipped';
  startedAt: number;
  durationMs: number;       // 该步骤耗时
  meta?: {
    noteId?: string;
    confidence?: number;
    attempt?: number;       // LLM 调用次数
    errorType?: string;     // 失败时的错误类型
    errorMessage?: string;
    // ...
  };
}
```

### 1.2 埋点的 7 个 step

| step | 作用 | 典型失败 |
|---|---|---|
| `load-notes` | 加载近 7 日笔记 | IndexedDB 连接异常 |
| `compute-similarity` | 计算嵌入余弦相似度 | 嵌入维度不匹配（已修复） |
| `check-bilink` | 检查已有双链 | 查询超时 |
| `create-proposal` | 创建提议 | 写入冲突 |
| `llm-call` | 调用 LLM 生成复习卡 | 超时 / 限流 / 额度耗尽 |
| `parse-response` | 解析 LLM 响应 | JSON 解析失败 / Zod 校验失败 |
| `retry-llm` | 重试 LLM | 重试仍失败 |

### 1.3 查询接口

```typescript
// 查某次 run 的完整轨迹
getTracesByRun(runId): Promise<AgentTrace[]>

// 按 step + errorType 聚合失败模式（按次数降序）
getFailureModes(limit?): Promise<FailureModeStat[]>
```

## 二、失败模式 Top 10（基于实际运行数据）

> 以下模式基于 Agent 在真实笔记数据上的运行轨迹。每个模式含：现象、根因、影响、修复方案。

### 模式 1：LLM 超时（llm-call × TimeoutError）

- **现象**：`llm-call` step 失败，errorType=TimeoutError
- **根因**：BYOK 的 OpenAI 兼容端点响应慢（>30s），或网络抖动
- **影响**：该笔记本次跳过复习卡生成，不影响双链提议（双链不依赖 LLM）
- **修复方案**：
  - 加 30s 超时 + 1 次重试（已实现 `retry-llm` step）
  - 重试仍失败则跳过该笔记，不中断整个 run
- **可观测性价值**：通过 trace 能算出"重试成功率"——如果重试也常失败，说明是额度/限流问题而非偶发抖动

### 模式 2：JSON 解析失败（parse-response × SyntaxError）

- **现象**：LLM 返回的文本无法 `JSON.parse`，或解析后不通过 Zod 校验
- **根因**：
  1. LLM 返回带 Markdown 代码块包裹（```json ... ```）
  2. LLM 返回了 JSON 但字段缺失（缺 front 或 back）
  3. LLM 返回了自由文本解释而非 JSON
- **影响**：触发 `retry-llm`，重试 prompt 加了"严格要求只输出 JSON"
- **修复方案**：
  - `parseReviewCards` 用正则提取 `[...]` 部分，容忍前后多余文字
  - Zod 校验失败视为解析失败，触发重试
- **可观测性价值**：`parse-response` 的 attempt=1 vs attempt=2 成功率对比，能衡量"重试 prompt"的有效性

### 模式 3：嵌入维度不匹配（compute-similarity × 静默失败）

- **现象**：`compute-similarity` step 显示 success，但 `proposalsFound=0`——表面成功实际无效
- **根因**：query 嵌入 384 维 vs 存储 768 维，cosine 恒 0（详见[博客 3](./blog/03-hybrid-search-dimension-mismatch-bug.md)）
- **影响**：双链提议数量骤降（只有关键词路，无语义路）
- **修复方案**：严格按 model 过滤（已修复）
- **可观测性价值**：这是"静默失败"的典型——trace 里 status=success 但 proposalsFound=0，需要看 meta 而非 status 才能发现。**教训：trace 的 meta 字段比 status 更重要**

### 模式 4：写入冲突（create-proposal × ConstraintError）

- **现象**：创建提议时 Dexie 报 ConstraintError（主键冲突）
- **根因**：同一对 (srcNoteId, dstNoteId) 在同一 run 内被重复提议
- **影响**：该提议跳过，不影响其他提议
- **修复方案**：`check-bilink` 步骤已检查已有双链，但未检查同 run 内的 pending 提议。修复是提议创建前去重
- **可观测性价值**：能统计"重复提议率"——如果高，说明相似度计算有冗余

### 模式 5：LLM 额度耗尽（llm-call × QuotaExceededError）

- **现象**：`llm-call` 失败，errorType 含 quota/rate_limit
- **根因**：BYOK 的 API key 额度用完，或触发 RPM 限流
- **影响**：所有复习卡生成失败，但双链提议不受影响
- **修复方案**：
  - 检测到限流错误时，跳过剩余笔记的 LLM 调用（fail-fast）
  - 在设置页提示用户"额度不足"
- **可观测性价值**：通过 `llm-call` 的 errorType 分布，能区分"偶发超时"vs"额度问题"，运维动作不同

### 模式 6：复习卡质量低（隐式失败，无 errorType）

- **现象**：`parse-response` 成功，但生成的复习卡 front/back 太长或无意义
- **根因**：prompt 不够约束，LLM 生成"请解释 XXX 的完整历史"这种宽泛问题
- **影响**：用户拒绝率高，复习卡价值低
- **修复方案**：prompt 加约束（front < 30 字，back < 100 字，问题具体）
- **可观测性价值**：trace 记录不了"质量"——需要配合用户拒绝率（proposals 表的 rejected 状态）分析

### 模式 7：置信度漂移（compute-similarity × 阈值边界）

- **现象**：双链提议的 confidence 集中在 0.6-0.65（阈值边缘）
- **根因**：0.6 阈值偏低，bge 模型在这个区间区分度差
- **影响**：低质量双链提议泛滥，用户拒绝率高
- **修复方案**：阈值从 0.6 提到 0.7，或加"置信度分层"（>0.8 自动接受，0.6-0.8 待确认）
- **可观测性价值**：trace 的 `meta.confidence` 分布能画出直方图，找最优阈值

### 模式 8：笔记内容过长导致 token 超限（llm-call × ContextLengthExceeded）

- **现象**：`llm-call` 失败，errorType 含 context_length
- **根因**：`truncate(note.content, 1500)` 是字符级截断，但 token 计数不同（中文 1 字 ≈ 1-2 token）
- **影响**：长笔记的复习卡生成失败
- **修复方案**：按 token 而非字符截断，或先摘要再生成复习卡
- **可观测性价值**：能定位是哪些笔记触发的（meta.noteId）

### 模式 9：重试仍失败（retry-llm × 持续失败）

- **现象**：`retry-llm` 后 `parse-response` 仍 failed
- **根因**：LLM 对该笔记的内容"无法理解"或顽固返回非 JSON
- **影响**：该笔记跳过，记日志 `复习卡解析重试仍失败`
- **修复方案**：重试 1 次后放弃（已实现），避免无限重试浪费 token
- **可观测性价值**：`retry-llm` 的成功率能判断"重试是否值得"——如果重试成功率 <20%，说明重试 prompt 无效

### 模式 10：IndexedDB 连接异常（load-notes × ConnectionError）

- **现象**：`load-notes` step 失败，整个 run 标记 failed
- **根因**：浏览器 IndexedDB 配额满、用户隐私模式禁用、或多 tab 竞争
- **影响**：整个 Agent run 失败，无提议生成
- **修复方案**：
  - 捕获连接错误，提示用户清理存储
  - 降级到"仅内存计算"（当次 run 无持久化）
- **可观测性价值**：这是 fatal 错误，trace 直接反映 run 级失败

## 三、失败模式分类框架

按两个维度分类：

| | 可恢复 | 不可恢复 |
|---|---|---|
| **已知模式** | LLM 超时（重试）、JSON 解析失败（重试）、写入冲突（去重） | 额度耗尽（需用户充值）、token 超限（需截断策略） |
| **未知模式** | 新的 errorType 出现 | fatal 错误（DB 连接） |

**工程原则**：
- 可恢复 → 重试 + 降级（已实现）
- 不可恢复 → fail-fast + 用户提示
- 未知 → trace 记录 errorType，定期 review 补充到已知模式

## 四、可观测性设计的 6 个原则

基于这次实践总结：

1. **trace 写入是 best-effort**——`recordTrace` 失败只打日志，不影响主流程。可观测性不能反噬业务可用性。

2. **meta 比 status 更重要**——status=success 但 proposalsFound=0 是"静默失败"，必须看 meta 才能发现。

3. **失败按 step × errorType 聚合**——单看"失败了"没用，要看"哪个步骤的哪类错误"才能定位。

4. **重试要单独 trace**——`llm-call` 和 `retry-llm` 分开记，才能算重试成功率。

5. **durationMs 用于性能回归**——改 prompt 或换模型后，对比同 step 的 durationMs 分布。

6. **配合业务指标**——trace 只能记录"过程"，"质量"要看 proposals 表的接受/拒绝率。两者结合才是完整可观测性。

## 五、面试价值

这份报告直接回答面试高频问题：

- **"你 Agent 踩过什么坑？"** → 模式 1-10，每个都有现象/根因/修复
- **"怎么监控 Agent？"** → 7 个 step 的 trace + 失败模式聚合
- **"Agent 失败了怎么办？"** → 可恢复/不可恢复分类框架
- **"怎么评估 Agent 效果？"** → trace 过程指标 + proposals 接受率业务指标

---

**相关代码**：
- [src/lib/db/agent-traces.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/db/agent-traces.ts) — trace DAO + 失败模式聚合
- [src/lib/ai/agent/runner.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/ai/agent/runner.ts) — runner 埋点
- [src/types/index.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/types/index.ts) — AgentTrace 类型定义
- [tests/unit/agent-traces.test.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/tests/unit/agent-traces.test.ts) — 7 个测试用例
