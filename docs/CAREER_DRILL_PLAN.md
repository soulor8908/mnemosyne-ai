# Mnemosyne · 找工作练兵场规划

> 把这个项目从"AI 时代的云笔记产品"变成一份**能打的 AI 工程师作品集**。
>
> 视角：卡帕西式技术取向 + 2026 AI 工程师招聘市场反向映射。
>
> 配套：[产品设计](./PRODUCT_DESIGN.md) · [技术设计](./TECHNICAL_DESIGN.md) · [飞书捕获](./superpowers/specs/2026-07-29-feishu-share-capture-design.md)

---

## 0. 一句话定位（求职版）

**这不是一个练手项目，这是一份"AI 应用工程师"的端到端能力证明**——local-first 架构 + RAG 检索 + Agent 工作流 + 零信任加密 + 边缘部署，每一个模块都直接对齐 2026 年 JD 高频关键词。

---

## 1. 技术栈全景图（按 JD 出现频率排序）

| 层级 | 你已有的栈 | JD 关键词命中 | 深耕价值 |
|---|---|---|---|
| **前端框架** | Next.js 15 + React 19 + Tailwind 3 | ⭐⭐⭐⭐⭐ 必备 | 中——证明你能写现代 React |
| **AI 编排** | Vercel AI SDK 3.4 + Zod schema | ⭐⭐⭐⭐⭐ 高频 | **高**——Agent/RAG 的工程化入口 |
| **RAG 检索** | 混合检索（关键词 + 向量 + RRF 融合） | ⭐⭐⭐⭐⭐ 核心 | **极高**——这是面试必问点 |
| **向量数据库** | 本地 idb-keyval + Workers AI bge | ⭐⭐⭐⭐ 高频 | **高**——但你的"本地向量索引"是差异化亮点 |
| **Agent 工作流** | 夜间 Agent + 工具调用 + 幂等键 + 提议收件箱 | ⭐⭐⭐⭐⭐ 核心 | **极高**——Agentic RAG 是 2026 主流 |
| **LLM 多模型路由** | DeepSeek / GLM / OpenAI BYOK | ⭐⭐⭐⭐ 高频 | 中——证明你懂成本/质量权衡 |
| **Local-First** | Dexie/IndexedDB + 增量同步 + 字段级合并 | ⭐⭐⭐ 差异化 | **高**——这是你的护城河，别人没有 |
| **零信任加密** | BIP39 助记词 + AES-GCM + MASTER_KEY 不落服务端 | ⭐⭐⭐ 加分项 | **高**——ToB/金融场景加分 |
| **边缘部署** | Cloudflare Workers + KV + R2 + OpenNext | ⭐⭐⭐ 加分项 | 中——证明你懂 Serverless 成本模型 |
| **间隔重复算法** | ts-fsrs 4.5 | ⭐⭐ 小众但深度 | 低——除非面教育/学习类产品 |
| **质量工程** | Vitest + Playwright + fake-indexeddb + 4 层门禁 | ⭐⭐⭐⭐ 加分 | **高**——"有 eval 体系"是 senior 信号 |
| **内容工程** | YAML prompt 版本化 + compile/validate 脚本 | ⭐⭐ 加分 | 中——证明你把 prompt 当代码 |
| **浏览器内推理** | @xenova/transformers 本地嵌入 | ⭐⭐⭐ 前沿 | **高**——"AI 在浏览器跑"是稀缺技能 |

---

## 2. 与 2026 JD 的匹配度矩阵

基于 5 份真实 JD（猎聘大模型搜索工程师 40-70k / Boss 直聘 AI Agent 工程师 / TalkingData AI 应用工程师 15-30k / 远图 AI 算法工程师 21-35k·20薪 / ZEGO AI 应用工程师）提炼的高频要求：

| JD 高频要求 | 你的项目现状 | 匹配度 | 缺口 |
|---|---|---|---|
| RAG 全流程：chunking/embedding/检索/重排/生成 | ✅ 有混合检索 + RRF 融合 | 70% | **缺：chunking 策略、Cross-Encoder 重排、RAGAS 评估** |
| Agent 工具调用 + 幂等 + 可观测性 | ✅ 有夜间 Agent + 幂等键 | 75% | **缺：Agent 轨迹追踪、失败模式分析、多 Agent 协作** |
| 向量数据库选型与调优 | ⚠️ 本地 idb-keyval（非生产级） | 50% | **缺：对比 Milvus/Qdrant/pgvector，写选型文档** |
| Function Calling / MCP | ⚠️ 有工具调用，无 MCP | 60% | **缺：把知识库暴露为 MCP server** |
| LLM 评估体系（evals） | ❌ 无系统化评估 | 20% | **极缺：这是 senior 与 junior 的分水岭** |
| Python + FastAPI | ❌ 全 TypeScript 栈 | 30% | **缺：补一个 Python 服务做对比/重排** |
| Prompt Engineering + 版本管理 | ⚠️ YAML 版本化但无 A/B | 60% | **缺：prompt A/B 测试、回归测试** |
| 成本与性能优化 | ✅ BYOK + Workers AI 免费层 | 80% | 已有，可继续深耕 |
| 从 0 到 1 落地经验 | ✅ 完整闭环 | 90% | **强项，简历主打** |
| Docker / K8s 部署 | ❌ 只有 Cloudflare 部署 | 30% | **缺：补 Dockerfile + 自托管方案** |
| 技术博客 / 开源 | ⚠️ 有仓库无博客 | 40% | **缺：写 3-5 篇深度技术博客** |

**总体匹配度：约 65%**——骨架齐全，但缺少 JD 反复强调的"评估体系""向量数据库选型""Python 栈"三个硬通货。

---

## 3. 可深挖 vs 可深耕

### 3.1 可深挖（已有基础，往深做能出面试亮点）

| 主题 | 现状 | 深挖方向 | 面试价值 |
|---|---|---|---|
| **混合检索** | 关键词 + 向量 + RRF | 加 Cross-Encoder 重排、查询改写、HyDE | ⭐⭐⭐⭐⭐ RAG 必问 |
| **Agent 工作流** | 单 Agent + 提议 | 多 Agent 协作（Supervisor 模式）、Agent 状态机、失败回放 | ⭐⭐⭐⭐⭐ Agent 必问 |
| **本地向量索引** | 全量余弦相似 | 加 HNSW 近似检索、向量量化（int8）、对比 benchmark | ⭐⭐⭐⭐ 差异化 |
| **同步引擎** | 时间戳 + 字段级合并 | 加 CRDT 对比文档、冲突可视化、多设备一致性证明 | ⭐⭐⭐ 加分 |
| **零信任加密** | BIP39 + AES-GCM | 加密性能 benchmark、密钥轮换、多方密钥分享 | ⭐⭐⭐ 加分 |

### 3.2 可深耕（新做一块，能补 JD 缺口）

| 主题 | 价值 | 为什么值得做 |
|---|---|---|
| **RAG 评估体系（RAGAS）** | ⭐⭐⭐⭐⭐ | JD 原话"建立测试集和评测指标"——这是 senior 信号，没有就是 junior |
| **MCP Server 暴露知识库** | ⭐⭐⭐⭐⭐ | JD 加分项"熟悉 MCP 协议"——2026 最热协议，做出来就是稀缺 |
| **Python 重排服务** | ⭐⭐⭐⭐ | JD 必备"熟练 Python"——补一个 FastAPI + Cross-Encoder 服务 |
| **向量数据库选型 benchmark** | ⭐⭐⭐⭐ | JD 高频"向量数据库选型"——写一份 Milvus vs Qdrant vs pgvector 对比 |
| **Docker 自托管方案** | ⭐⭐⭐ | JD 必备"Docker 部署"——证明你不只会 Serverless |
| **技术博客 3-5 篇** | ⭐⭐⭐⭐⭐ | JD 加分项"有技术博客/开源贡献"——没有就等于没做 |

---

## 4. 发展方向 Plan（按性价比排序）

> **性价比 = 面试价值 ÷ 实现成本**。价值高的先做，成本低的先做。

### Phase A：补 JD 硬通货（性价比 ⭐⭐⭐⭐⭐，最高优先级）

#### A1. RAG 评估体系（RAGAS + 自建测试集）
- **关键技术要点**：
  - 用 RAGAS 指标：faithfulness（忠实度）、answer_relevancy（答案相关性）、context_recall（上下文召回率）、context_precision（上下文精确率）
  - 自建 50-100 条问答测试集（从你的真实笔记里抽）
  - 每次改检索策略跑一次 eval，形成回归基线
- **核心注意点**：
  - 测试集要覆盖 hard case（多笔记综合、跨时间关联、无答案场景）
  - eval 结果要版本化，跟 prompt/检索策略版本绑定
- **价值量**：⭐⭐⭐⭐⭐——面试官问"你怎么评估 RAG 效果"时，能掏出 eval 报告就是 senior

#### A2. MCP Server 暴露知识库
- **关键技术要点**：
  - 用 `@modelcontextprotocol/sdk` 把笔记检索/读取/双链查询暴露为 MCP tools
  - 让 Claude Desktop / Cursor / 其他 Agent 能直接读你的知识库
  - 实现 `search_notes` / `get_note` / `get_bilinks` / `get_review_queue` 四个工具
- **核心注意点**：
  - MCP 是 2026 最热协议，做出来就是稀缺技能
  - 要写一篇博客讲清楚 MCP server 怎么写、怎么调试
- **价值量**：⭐⭐⭐⭐⭐——JD 原话"熟悉 MCP 协议或有相关 Tool 开发经验"

#### A3. Cross-Encoder 重排 + Python 服务
- **关键技术要点**：
  - 加一层 rerank：检索 top-20 → Cross-Encoder（bge-reranker-v2-m3）重排 → 取 top-5
  - 用 FastAPI 包一个 `/rerank` 服务，Docker 部署
  - 对比有无重排的 RAGAS 指标变化
- **核心注意点**：
  - Cross-Encoder 比 Bi-Encoder 慢 10-100x，必须控制候选数
  - Python 服务和 TS 主应用通过 HTTP 解耦，证明你能跨语言协作
- **价值量**：⭐⭐⭐⭐——一次性补"Python + 重排 + Docker"三个缺口

---

### Phase B：强化已有亮点（性价比 ⭐⭐⭐⭐）

#### B1. 多 Agent 协作（Supervisor 模式）
- **关键技术要点**：
  - 把现有单 Agent 拆成：Collector Agent（收集候选）+ Reviewer Agent（审核质量）+ Writer Agent（生成提议）
  - Supervisor Agent 编排三者，状态机管理流转
  - 用 LangGraph 或自研状态机实现
- **核心注意点**：
  - 多 Agent 的坑是"谁信谁"——必须有明确的 handoff 协议
  - 要能画出 Agent 调用图，面试时讲清楚
- **价值量**：⭐⭐⭐⭐——JD"多 Agent 协作机制"高频词

#### B2. 本地向量索引 benchmark + HNSW
- **关键技术要点**：
  - 现状是全量余弦相似 O(n)，加 HNSW 近似检索降到 O(log n)
  - 对比：全量 vs HNSW vs 量化（int8）的召回率/延迟/内存
  - 写一份 benchmark 报告
- **核心注意点**：
  - 单用户 < 1 万条笔记时全量够用，但 benchmark 能证明你懂工程权衡
  - HNSW 参数（M、efConstruction、efSearch）要调，记录调参过程
- **价值量**：⭐⭐⭐⭐——JD"向量数据库性能调优"加分项

#### B3. Agent 可观测性 + 失败模式分析
- **关键技术要点**：
  - 用 OpenTelemetry / LangSmith 给 Agent 加轨迹追踪
  - 记录每次工具调用、token 消耗、延迟、失败原因
  - 写一份"Agent 失败模式 Top 10"分析报告
- **核心注意点**：
  - JD 原话"能说出 Agent 的失败模式"——这是区分 senior 的题
  - 失败模式举例：幻觉双链、置信度漂移、token 超限、工具调用循环
- **价值量**：⭐⭐⭐⭐⭐——直接命中 JD 面试题

---

### Phase C：补全工程闭环（性价比 ⭐⭐⭐）

#### C1. Docker 自托管方案
- **关键技术要点**：
  - 写 Dockerfile + docker-compose.yml
  - 把 Cloudflare KV 换成自托管 Redis/Postgres 的适配层
  - 提供一键 `docker compose up` 的本地部署
- **核心注意点**：
  - 证明你不只会 Serverless，也能做传统部署
  - 自托管版本可以作为开源卖点
- **价值量**：⭐⭐⭐——JD"Docker 部署"必备

#### C2. 浏览器内推理深化
- **关键技术要点**：
  - 现状用 @xenova/transformers 跑嵌入，深化到：本地小模型做实时补全、本地 Whisper 做语音转文字
  - WebGPU 加速（取代 WASM）
  - 对比本地 vs 云端的延迟/隐私/成本
- **核心注意点**：
  - 浏览器内推理是稀缺技能，能讲清楚 WebGPU vs WASM 就是亮点
  - 要有真实性能数据，不能只讲概念
- **价值量**：⭐⭐⭐——前沿加分项

#### C3. 技术博客 3-5 篇
- **关键技术要点**：
  - 选题（按面试价值排序）：
    1. 《local-first + 零信任加密的云笔记架构》——讲架构取舍
    2. 《从全量余弦到 HNSW：浏览器内向量检索的工程实践》——讲性能
    3. 《Agent 提议收件箱：让 AI 替你整理知识库的设计》——讲 Agent
    4. 《RAGAS 实战：如何给你的 RAG 系统装上仪表盘》——讲评估
    5. 《MCP Server 从 0 到 1：让 Claude 读你的知识库》——讲前沿
  - 发在掘金/知乎/个人博客，简历挂链接
- **核心注意点**：
  - JD 原话"有技术博客、开源项目或公开演讲经验"——没有等于没做
  - 每篇要有真实代码 + 真实数据，不能是概念搬运
- **价值量**：⭐⭐⭐⭐⭐——性价比最高的简历加分项

---

## 5. 12 周执行计划

> 按性价比排序，每周一个可交付物，12 周后简历脱胎换骨。

| 周 | 任务 | 交付物 | 面试价值 |
|---|---|---|---|
| W1 | RAGAS 评估体系 + 测试集 | `tests/eval/rag-test-set.jsonl` + eval 报告 | ⭐⭐⭐⭐⭐ |
| W2 | Cross-Encoder 重排 + Python FastAPI 服务 | `services/rerank/` + Dockerfile | ⭐⭐⭐⭐ |
| W3 | MCP Server 暴露知识库 | `services/mcp/` + 调试文档 | ⭐⭐⭐⭐⭐ |
| W4 | 写博客 1：《local-first 零信任云笔记架构》 | 掘金/知乎文章链接 | ⭐⭐⭐⭐⭐ |
| W5 | HNSW 本地向量索引 + benchmark | `src/lib/ai/hnsw.ts` + benchmark 报告 | ⭐⭐⭐⭐ |
| W6 | Agent 可观测性 + 失败模式报告 | OTel 集成 + `docs/agent-failure-modes.md` | ⭐⭐⭐⭐⭐ |
| W7 | 多 Agent 协作（Supervisor 模式） | `src/lib/ai/agent/multi-agent.ts` | ⭐⭐⭐⭐ |
| W8 | 写博客 2：《Agent 提议收件箱设计》 | 文章链接 | ⭐⭐⭐⭐⭐ |
| W9 | Docker 自托管方案 | `docker-compose.yml` + 自托管文档 | ⭐⭐⭐ |
| W10 | 浏览器内推理深化（WebGPU + Whisper） | `src/lib/ai/local-inference.ts` | ⭐⭐⭐ |
| W11 | 写博客 3：《RAGAS 实战》或《MCP Server 实战》 | 文章链接 | ⭐⭐⭐⭐⭐ |
| W12 | 简历重构 + 项目 README 重写 | 简历 + README，挂博客/eval/benchmark 链接 | ⭐⭐⭐⭐⭐ |

---

## 6. 简历呈现模板（12 周后）

```
Mnemosyne · AI 时代的 local-first 云笔记
https://github.com/soulor8908/mnemosyne-ai

技术栈：Next.js 15 / React 19 / TypeScript / Dexie/IndexedDB / Cloudflare Workers + KV + R2 /
       Vercel AI SDK / Workers AI / @xenova/transformers / ts-fsrs / Zod / Vitest / Playwright

核心能力（对齐 AI 应用工程师 JD）：
- RAG 全流程：混合检索（关键词+向量+RRF）+ Cross-Encoder 重排 + RAGAS 评估体系
  · 自建 100 条测试集，faithfulness 0.82，context_recall 0.76
  · 详见博客：https://...
- Agent 工作流：夜间 Agent + 多 Agent 协作（Supervisor 模式）+ 幂等键 + OTel 轨迹追踪
  · 沉淀"Agent 失败模式 Top 10"分析报告
- MCP Server：把知识库暴露为 MCP tools，Claude Desktop 可直接检索
  · 详见博客：https://...
- 向量检索工程：浏览器内 HNSW 近似检索 + int8 量化，benchmark 对比 Milvus/Qdrant
- Local-First 架构：Dexie 本地真理 + Cloudflare KV 加密备份 + 字段级合并同步
- 零信任加密：BIP39 助记词派生 MASTER_KEY，服务端永不见明文
- 浏览器内推理：@xenova/transformers + WebGPU，隐私模式纯本地嵌入
- 质量工程：Vitest + Playwright + fake-indexeddb + 4 层 pre-push 门禁

技术博客：
1. 《local-first + 零信任加密的云笔记架构》
2. 《Agent 提议收件箱：让 AI 替你整理知识库的设计》
3. 《RAGAS 实战：如何给你的 RAG 系统装上仪表盘》
```

---

## 7. 风险与取舍

| 风险 | 应对 |
|---|---|
| 12 周做不完 | 按 Phase A→B→C 优先级砍，A 做完就能投简历 |
| 博客写不出来 | 边做边记笔记，最后整理成文，不要憋大招 |
| Python 不熟 | Phase A3 的重排服务就是练手，做出来就有底气 |
| 向量数据库没生产经验 | benchmark 报告比生产经验更有说服力，面试官看重的是工程思维 |
| MCP 太新没资料 | 官方 SDK 文档 + Claude Desktop 调试，做出来就是稀缺 |

---

## 8. 卡帕西式总结

> "每个工程师都应该有一个'论文级'的项目——不是 CRUD，不是套壳，而是能在每个技术点上讲清楚 why。"
>
> 这个项目的价值不在于"做了一个云笔记"，而在于：
> 1. **local-first 是反主流的**——主流是 SaaS，你做本地优先，证明你敢做架构取舍
> 2. **零信任是 ToB 级的**——把金融级的加密搬到 C 端，证明你懂安全
> 3. **Agent 提议而非直接改**——证明你理解 AI 的边界，AI 是助手不是替代
> 4. **RAGAS 评估而非感觉**——证明你是工程师不是 demo 选手
> 5. **MCP 暴露而非封闭**——证明你懂生态，AI 时代的产品是开放的
>
> 把这 5 点做到位，简历就不是"做过 AI 项目"，而是"想清楚了 AI 时代的产品架构"。

---

## 9. 立即开始的第一步

**本周（W1）就做 RAGAS 评估体系**——这是性价比最高、缺口最大、面试必问的一项。

具体动作：
1. 从你的真实笔记里抽 50-100 条，标注问答对
2. 接入 RAGAS，跑一次基线 eval
3. 把 eval 报告 commit 到仓库
4. 简历就能写"自建 RAGAS 评估体系，faithfulness X.XX"

做完这一步，后面 11 周就有节奏了。
