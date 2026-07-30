# 简历项目描述：Mnemosyne AI

> 用于简历投递的项目描述模板。按 JD 要求可裁剪——投 RAG 岗突出检索+评估，投 Agent 岗突出多 Agent+可观测性，投全栈岗突出 local-first+零信任。

---

## 通用版（投 AI 应用工程师）

**Mnemosyne · AI 时代的 local-first 云笔记**
https://github.com/soulor8908/mnemosyne-ai

技术栈：Next.js 15 / React 19 / TypeScript / Dexie/IndexedDB / Cloudflare Workers + KV / Vercel AI SDK / Workers AI / @xenova/transformers / @modelcontextprotocol/sdk / Python FastAPI / Vitest(166 tests) / Docker Compose

- **标准 MCP Server**：stdio 传输，4 工具（capture/embed/ask/search），Claude Desktop 可直连；纯逻辑客户端 + 依赖注入，15 个测试用例
- **零信任多用户认证**：SCRAM-lite 挑战应答，masterKey 永不上传；双令牌鉴权 + sha256 时序安全比较 + fail-closed
- **RAG 全流程**：混合检索（关键词+向量+RRF）+ HNSW 近似索引 + Cross-Encoder 重排 + RAGAS 评估（4 指标 + 35 条测试集）
  · 修复过 query 嵌入维度不匹配导致语义检索静默失效的真实 bug
  · 自建测试集，LLM-as-Judge 打分，回归基线版本对比
- **Agent 工作流**：夜间 Agent + 幂等键 + 多 Agent Supervisor 模式（Collector→Reviewer→Writer）
  · 7 step 轨迹追踪 + 失败模式聚合分析，沉淀"Agent 失败模式 Top 10"报告
- **向量检索工程**：纯 TS 实现 HNSW（O(log n)），benchmark 对比暴力搜索召回率 96-100%
- **浏览器内推理**：WebGPU 优先 + WASM 降级，@xenova/transformers 本地嵌入
- **Local-First 架构**：Dexie 本地真理 + KV 加密备份 + 字段级合并 + 冲突快照
- **质量工程**：19 测试文件 / 166 用例 / 4 层门禁 / GitHub Actions CI
- **OpenAPI 3.1 规范** + Docker 自托管方案（web + redis + rerank 三服务）

技术博客：
1. 《local-first + 零信任多用户登录的云笔记架构》
2. 《从 0 到 1 写一个标准 MCP Server》
3. 《混合检索的坑：维度不匹配 bug 复盘》
4. 《RAGAS 实战：给 RAG 系统装上仪表盘》

---

## RAG 方向版（突出检索 + 评估）

**Mnemosyne · RAG 系统的工程化实践**
https://github.com/soulor8908/mnemosyne-ai

- **混合检索**：关键词 + 语义向量 + RRF 融合，模型严格过滤防维度混用
- **HNSW 本地索引**：纯 TS 实现，O(log n) 查询，benchmark 召回率 96-100%
- **Cross-Encoder 重排**：Python FastAPI 服务（bge-reranker-v2-m3），top-20 重排 top-5
- **RAGAS 评估体系**：4 指标（faithfulness/answerRelevancy/contextRecall/contextPrecision）+ 35 条测试集 + LLM-as-Judge
  · 修复过维度不匹配导致语义检索静默失效的 bug（cosine 恒 0，无报错无日志）
  · 测试集覆盖 4 类场景：factual / synthesis / no-answer / cross-time
  · 回归基线管理：改检索策略后 git diff 对比指标变化
- **RAG 踩坑总结**：静默失败检测、组件契约测试、降级带标签、0 是合法返回值

---

## Agent 方向版（突出多 Agent + 可观测性）

**Mnemosyne · Agent 工作流的工程化实践**
https://github.com/soulor8908/mnemosyne-ai

- **多 Agent 协作**：Supervisor 模式，Collector（收集候选）→ Reviewer（质量审查）→ Writer（内容产出），状态机编排
  · 数据契约用 TypeScript interface 明确定义
  · Writer 失败双层保护（内部 catch + Supervisor catch），降级保留双链提议
- **Agent 可观测性**：7 step 轨迹追踪（load-notes/compute-similarity/check-bilink/create-proposal/llm-call/parse-response/retry-llm）
  · traceStep 高阶函数自动计时，trace 写入 best-effort（不反噬业务）
  · getFailureModes 按 step × errorType 聚合，沉淀"失败模式 Top 10"报告
- **幂等设计**：幂等键防重复执行，check-bilink 防重复提议
- **降级策略**：LLM 失败重试 1 次，重试失败跳过该笔记不中断整个 run
- **失败模式分析**：LLM 超时 / JSON 解析失败 / 静默失败 / 写入冲突 / 额度耗尽 / 置信度漂移 / token 超限 / 重试仍失败 / DB 连接异常

---

## 全栈方向版（突出架构 + 安全）

**Mnemosyne · Local-First 全栈架构实践**
https://github.com/soulor8908/mnemosyne-ai

- **Local-First 架构**：Dexie/IndexedDB 本地真理 + Cloudflare KV 加密备份 + 字段级合并 + 冲突快照
- **零信任多用户登录**：SCRAM-lite 挑战应答，masterKey 永不上传，verifier 存储
  · 双令牌鉴权（SYNC_TOKEN + 会话），sha256 时序安全比较防侧信道，fail-closed
  · 审计日志 90 天 TTL，登录可追溯
- **加密同步**：AES-GCM + PBKDF2（10万次），BIP39 助记词派生主密钥，云端只见密文
  · 字段级合并（tags 并集 / frontmatter 浅合并 / content 按 updatedAt）
- **MCP Server**：标准 stdio 协议，4 工具，Claude Desktop 可直连
  · 端到端加密 vs 外部检索的架构矛盾，三层降级方案
- **OpenAPI 3.1**：全端点文档化，E2E 加密边界明确
- **Docker 自托管**：web + redis + rerank 三服务，数据主权完全自主
- **质量工程**：166 个测试用例，4 层门禁（lint + typecheck + test + build），GitHub Actions CI

---

## 面试高频问题预案

### "你 RAG 踩过什么坑？"
→ 维度不匹配导致 cosine 恒 0，静默失败。三层防御：模型过滤 / 降级带标签 / 诚实返回 null。详见[博客 3](docs/blog/03-hybrid-search-dimension-mismatch-bug.md)。

### "怎么评估 RAG 效果？"
→ RAGAS 4 指标 + LLM-as-Judge + 35 条测试集（含 no-answer 场景）+ git diff 回归对比。详见[博客 4](docs/blog/04-ragas-evaluation-in-practice.md)。

### "Agent 失败了怎么办？"
→ 7 step 轨迹追踪 + 失败模式聚合。可恢复的（超时/解析失败）重试降级，不可恢复的（额度耗尽）fail-fast。详见[失败模式报告](docs/agent-failure-modes.md)。

### "零信任怎么登录？"
→ SCRAM-lite 三步握手：客户端发 userId+verifier → 服务端发 challenge → 客户端回 response。masterKey 永不出客户端。详见[博客 1](docs/blog/01-local-first-zerotrust-architecture.md)。

### "MCP Server 怎么写？"
→ @modelcontextprotocol/sdk + StdioServerTransport，Zod 定义参数 schema，4 工具覆盖 capture/embed/ask/search。详见[博客 2](docs/blog/02-mcp-server-from-scratch.md)。

### "多 Agent 怎么协作？"
→ Supervisor 状态机编排 Collector → Reviewer → Writer。数据契约用 interface 定义，Writer 失败降级保留双链提议。详见[multi-agent.ts](src/lib/ai/agent/multi-agent.ts)。

### "HNSW 为什么自己实现？"
→ 单用户 <1万条，本地 HNSW 够用且零依赖。benchmark 显示召回率 96-100%，小数据量 JS 常数因子大反而比暴力慢——这是真实工程结论。详见[hnsw.ts](src/lib/ai/hnsw.ts)。

### "怎么保证代码质量？"
→ 166 个测试，4 层门禁（lint + typecheck + test + build），GitHub Actions CI。测试覆盖纯逻辑（RAGAS 指标）、集成（inbox 导入）、契约（OpenAPI 校验）。

---

## 数字亮点（简历可量化）

| 维度 | 数字 |
|---|---|
| 测试用例数 | 166 |
| 测试文件数 | 19 |
| 技术博客数 | 4 |
| RAGAS 测试集 | 35 条 |
| HNSW 召回率 | 96-100% |
| Agent 追踪 step 数 | 7 |
| MCP 工具数 | 4 |
| 支持 LLM 提供商 | 3（DeepSeek/GLM/OpenAI） |
| 部署方式 | 2（Cloudflare + Docker） |
| 向量维度 | 2（384 本地 / 768 云端） |
