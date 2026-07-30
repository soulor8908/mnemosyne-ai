# Mnemosyne · 找工作练兵场规划（v2 · 基于代码现状重扫）

> 把这个项目从"AI 时代的云笔记产品"变成一份**能打的 AI 工程师作品集**。
>
> 视角：卡帕西式技术取向 + 2026 AI 工程师招聘市场反向映射。
>
> 配套：[产品设计](./PRODUCT_DESIGN.md) · [技术设计](./TECHNICAL_DESIGN.md) · [飞书捕获](./superpowers/specs/2026-07-29-feishu-share-capture-design.md) · [OpenAPI](../openapi.yaml)

---

## 0. 一句话定位（求职版）

**这不是一个练手项目，这是一份"AI 应用工程师"的端到端能力证明**——local-first 架构 + 零信任多用户登录 + RAG 混合检索 + Agent 工作流 + 标准 MCP Server + OpenAPI 规范 + 边缘部署，每一个模块都直接对齐 2026 年 JD 高频关键词。

---

## 1. 代码现状重扫（v2 新增）

相比 v1 规划，项目已大幅推进。下面是**已落地**的能力清单。

### 1.1 v2 新增的核心能力

| 模块 | 文件 | 能力 | JD 命中 |
|---|---|---|---|
| **标准 MCP Server** | [src/mcp/server.ts](file:///workspace/src/mcp/server.ts) | stdio 传输，4 个工具（capture/embed/ask/search），Claude Desktop 可直接连 | ⭐⭐⭐⭐⭐ |
| **MCP 纯逻辑客户端** | [src/mcp/client.ts](file:///workspace/src/mcp/client.ts) | 纯 fetch，无 Next/CF 依赖，可注入测试，含本地导出检索 | ⭐⭐⭐⭐ |
| **零信任多用户登录** | [src/lib/auth/zerotrust.ts](file:///workspace/src/lib/auth/zerotrust.ts) | SCRAM-lite 挑战应答，masterKey 永不上传，verifier 存储 | ⭐⭐⭐⭐⭐ |
| **API 鉴权守卫** | [src/lib/auth/guard.ts](file:///workspace/src/lib/auth/guard.ts) | 双令牌（SYNC_TOKEN + 会话），sha256 时序安全比较，fail-closed | ⭐⭐⭐⭐ |
| **网页剪藏 API** | [src/app/api/capture/route.ts](file:///workspace/src/app/api/capture/route.ts) | 服务端抓取 + 正文提取，超时/体积护栏，UA 伪装 | ⭐⭐⭐ |
| **HTML 正文提取** | [src/lib/ai/grounding.ts](file:///workspace/src/lib/ai/grounding.ts) | 纯函数，无 DOM 依赖，article/main 优先，Workers 可跑 | ⭐⭐⭐ |
| **混合检索增强** | [src/lib/ai/search.ts](file:///workspace/src/lib/ai/search.ts) | 修复维度不匹配 bug，模型严格过滤，云端降级本地 | ⭐⭐⭐⭐⭐ |
| **OpenAPI 3.1 规范** | [openapi.yaml](file:///workspace/openapi.yaml) | 全端点文档化，Bearer 鉴权，E2E 加密边界说明 | ⭐⭐⭐⭐ |
| **会话管理** | [src/lib/auth/session.ts](file:///workspace/src/lib/auth/session.ts) | 删除 masterKey 透传漏洞，改纯 Bearer，审计日志 | ⭐⭐⭐⭐ |
| **捕获页面** | [src/app/capture/page.tsx](file:///workspace/src/app/capture/page.tsx) | 前端剪藏入口 | ⭐⭐ |
| **CI 工作流** | [.github/workflows/ci.yml](file:///workspace/.github/workflows/ci.yml) | GitHub Actions 自动化 | ⭐⭐⭐ |

### 1.2 测试覆盖（108/108 通过）

```
✓ tests/mcp-client.test.ts           (15 tests)  MCP 客户端 + 本地检索
✓ tests/integration/sync-engine.test.ts (4 tests)  同步引擎
✓ tests/unit/zerotrust.test.ts       (7 tests)   零信任挑战应答
✓ tests/unit/inbox-parser.test.ts    (13 tests)  飞书 inbox 解析
✓ tests/integration/inbox-ingest.test.ts (6 tests) inbox 导入
✓ tests/unit/fsrs.test.ts            (6 tests)   间隔重复
✓ tests/integration/crypto.test.ts   (7 tests)   BIP39 + AES-GCM
✓ tests/unit/grounding.test.ts       (7 tests)   HTML 正文提取
✓ tests/unit/rrf-fusion.test.ts      (5 tests)   RRF 融合
✓ tests/unit/guard.test.ts           (7 tests)   鉴权守卫
✓ tests/unit/utils.test.ts           (13 tests)  工具函数
✓ tests/integration/notes.test.ts    (5 tests)   笔记 DAO
✓ tests/openapi.test.ts              (7 tests)   OpenAPI 规范校验
✓ tests/unit/agent-review-cards.test.ts (6 tests) Agent 复习卡
```

**14 个测试文件，108 个用例，全绿。** 这本身就是一个面试加分项——"我的项目有 108 个测试"。

### 1.3 v1 规划的完成度

| v1 任务 | 状态 | 说明 |
|---|---|---|
| ~~MCP Server 暴露知识库~~ | ✅ **已完成** | 标准 stdio + 4 工具，比 v1 设想更完整 |
| ~~零信任加密深化~~ | ✅ **已完成** | 从单 token 升级到多用户 SCRAM-lite |
| ~~OpenAPI 规范~~ | ✅ **已完成** | v1 未列，超额完成 |
| ~~HTML 正文提取~~ | ✅ **已完成** | v1 未列，grounding.ts 纯函数 |
| RAGAS 评估体系 | ❌ 未做 | 仍是头号缺口 |
| Cross-Encoder 重排 + Python | ❌ 未做 | 仍是缺口 |
| HNSW 本地向量索引 | ❌ 未做 | 仍是缺口 |
| Agent 可观测性 | ❌ 未做 | 仍是缺口 |
| 多 Agent 协作 | ❌ 未做 | 仍是缺口 |
| Docker 自托管 | ❌ 未做 | 仍是缺口 |
| 技术博客 | ❌ 未做 | 仍是缺口 |

**结论**：MCP / 零信任 / OpenAPI 三块已超额完成，现在最大缺口集中在 **RAG 评估 + 检索深化 + Agent 可观测性 + Python 栈 + 博客**。

---

## 2. 技术栈全景图（v2 更新）

| 层级 | 栈 | JD 命中 | 深耕价值 | v2 变化 |
|---|---|---|---|---|
| **前端框架** | Next.js 15 + React 19 + Tailwind 3 | ⭐⭐⭐⭐⭐ | 中 | - |
| **AI 编排** | Vercel AI SDK 3.4 + Zod | ⭐⭐⭐⭐⭐ | 高 | - |
| **RAG 检索** | 关键词 + 向量 + RRF + 模型严格过滤 | ⭐⭐⭐⭐⭐ | 极高 | 修复维度 bug，更健壮 |
| **向量数据库** | 本地 idb-keyval + Workers AI bge | ⭐⭐⭐⭐ | 高 | - |
| **Agent 工作流** | 夜间 Agent + 幂等键 + 提议收件箱 | ⭐⭐⭐⭐⭐ | 极高 | - |
| **MCP Server** | @modelcontextprotocol/sdk + stdio | ⭐⭐⭐⭐⭐ | 极高 | 🆕 已落地 |
| **零信任认证** | SCRAM-lite + BIP39 + 多用户 session | ⭐⭐⭐⭐⭐ | 极高 | 🆕 从单 token 升级 |
| **OpenAPI 规范** | 3.1.0 + Bearer + E2E 边界 | ⭐⭐⭐⭐ | 中 | 🆕 已落地 |
| **LLM 多模型路由** | DeepSeek / GLM / OpenAI BYOK | ⭐⭐⭐⭐ | 中 | - |
| **Local-First** | Dexie + 增量同步 + 字段级合并 + 冲突快照 | ⭐⭐⭐ | 高 | - |
| **网页剪藏** | 服务端抓取 + 纯函数正文提取 | ⭐⭐⭐ | 中 | 🆕 已落地 |
| **边缘部署** | Cloudflare Workers + KV + R2 | ⭐⭐⭐ | 中 | - |
| **间隔重复** | ts-fsrs 4.5 | ⭐⭐ | 低 | - |
| **质量工程** | Vitest + 108 测试 + 4 层门禁 + CI | ⭐⭐⭐⭐⭐ | 高 | 🆕 测试数翻倍 |
| **浏览器内推理** | @xenova/transformers | ⭐⭐⭐ | 高 | - |

---

## 3. v2 匹配度矩阵（重新评估）

| JD 高频要求 | 项目现状 | 匹配度 | 缺口 |
|---|---|---|---|
| RAG 全流程 | ✅ 混合检索 + RRF + 模型过滤 + 降级 | **80%** ↑ | 缺 chunking、Cross-Encoder 重排、RAGAS |
| Agent 工具调用 + 幂等 + 可观测性 | ✅ Agent + 幂等键 | 75% | 缺轨迹追踪、失败模式、多 Agent |
| **MCP / Function Calling** | ✅ **标准 MCP stdio server** | **95%** ↑↑ | 几乎无缺口，可写博客 |
| **零信任 / 多用户安全** | ✅ **SCRAM-lite + 审计** | **90%** ↑↑ | 可加密密钥轮换 |
| 向量数据库选型 | ⚠️ 本地 idb-keyval | 50% | 缺 Milvus/Qdrant 对比 |
| LLM 评估体系 | ❌ 无 | 20% | **极缺——头号缺口** |
| Python + FastAPI | ❌ 全 TS | 30% | 缺 Python 服务 |
| Prompt Engineering + 版本管理 | ⚠️ 部分 | 60% | 缺 A/B、回归测试 |
| 成本与性能优化 | ✅ BYOK + 免费层 | 80% | - |
| 从 0 到 1 落地 | ✅ 完整闭环 + OpenAPI | **95%** ↑ | 强项 |
| Docker / K8s | ❌ 只有 CF | 30% | 缺 Dockerfile |
| 技术博客 / 开源 | ⚠️ 有仓库 | 40% | 缺博客 |

**总体匹配度：从 v1 的 65% 提升到约 78%**——MCP + 零信任 + OpenAPI 三块补齐后，已超过多数"调过 API"的候选人。

**剩余硬通货缺口（按优先级）**：
1. RAGAS 评估体系（20% → 必须补）
2. Python + FastAPI 服务（30% → 必须补）
3. 技术博客（40% → 性价比最高）
4. 向量数据库选型 benchmark（50% → 加分）
5. Agent 可观测性（75% → 拉到 95%）
6. Docker 自托管（30% → 补工程闭环）

---

## 4. v2 发展方向 Plan（重新排序）

> 原则：**已完成的不再做，缺口大的优先做，性价比高的先做**。

### Phase A：补 JD 硬通货（性价比 ⭐⭐⭐⭐⭐）

#### A1. RAGAS 评估体系（仍是头号缺口）
- **现状**：检索代码健壮（修复了维度 bug），但无评估
- **关键技术要点**：
  - RAGAS 指标：faithfulness / answer_relevancy / context_recall / context_precision
  - 自建 50-100 条问答测试集（从真实笔记抽）
  - 每次 RAG 策略变更跑 eval，形成回归基线
  - 结果版本化，与检索策略版本绑定
- **核心注意点**：
  - 测试集必须覆盖 hard case（跨笔记综合、无答案、跨时间关联）
  - 要能画出"改了重排策略后 faithfulness 从 0.72 → 0.82"这种曲线
- **价值量**：⭐⭐⭐⭐⭐——senior 信号，JD 原话"建立测试集和评测指标"

#### A2. Cross-Encoder 重排 + Python FastAPI 服务
- **现状**：无重排，全 TS 栈
- **关键技术要点**：
  - 检索 top-20 → Cross-Encoder（bge-reranker-v2-m3）重排 → top-5
  - FastAPI 包 `/rerank` 服务，Docker 部署
  - 对比有无重排的 RAGAS 指标
  - 与现有 MCP server 的 `search_notes` 打通
- **核心注意点**：
  - Cross-Encoder 慢 10-100x，控制候选数
  - Python 服务与 TS 主应用 HTTP 解耦
- **价值量**：⭐⭐⭐⭐——一次补"Python + 重排 + Docker"三个缺口

#### A3. 技术博客 3-5 篇（性价比最高）
- **现状**：有仓库无博客
- **选题（按已有素材排序，边做边写）**：
  1. 《local-first + 零信任多用户登录的云笔记架构》——**素材已全**，zerotrust.ts + guard.ts 可直接讲
  2. 《从 0 到 1 写一个标准 MCP Server：让 Claude 读你的知识库》——**素材已全**，server.ts + client.ts 可直接讲
  3. 《混合检索的坑：query 嵌入维度不匹配导致语义检索失效》——**真实 bug 修复**，search.ts 有注释
  4. 《RAGAS 实战：给 RAG 系统装上仪表盘》——做完 A1 后写
  5. 《108 个测试：local-first 应用的测试策略》——**素材已全**，14 个测试文件可讲
- **核心注意点**：
  - JD 原话"有技术博客/开源贡献"——没有等于没做
  - 前 3 篇素材已齐，**本周就能写**
- **价值量**：⭐⭐⭐⭐⭐——性价比最高，已有代码直接变现

---

### Phase B：强化已有亮点（性价比 ⭐⭐⭐⭐）

#### B1. Agent 可观测性 + 失败模式分析
- **现状**：Agent runner 有错误日志但无轨迹追踪
- **关键技术要点**：
  - OpenTelemetry / LangSmith 给 Agent 加 trace
  - 记录每次工具调用、token、延迟、失败原因
  - 写"Agent 失败模式 Top 10"报告
- **核心注意点**：
  - JD 原话"能说出 Agent 的失败模式"——senior 面试题
  - 失败模式：幻觉双链、置信度漂移、token 超限、工具循环
- **价值量**：⭐⭐⭐⭐⭐——直接命中面试题

#### B2. HNSW 本地向量索引 + benchmark
- **现状**：全量余弦 O(n)
- **关键技术要点**：
  - 加 HNSW 近似检索 O(log n)
  - 对比全量 vs HNSW vs int8 量化的召回率/延迟/内存
  - 写 benchmark 报告
- **核心注意点**：
  - 单用户 < 1 万条全量够用，但 benchmark 证明工程权衡能力
  - HNSW 参数（M、efConstruction、efSearch）调参记录
- **价值量**：⭐⭐⭐⭐——JD"向量数据库性能调优"

#### B3. 多 Agent 协作（Supervisor 模式）
- **现状**：单 Agent
- **关键技术要点**：
  - 拆成 Collector + Reviewer + Writer 三 Agent
  - Supervisor 编排，状态机管理
  - LangGraph 或自研状态机
- **核心注意点**：
  - 多 Agent 的坑是 handoff 协议
  - 要能画调用图
- **价值量**：⭐⭐⭐⭐——JD"多 Agent 协作"高频

---

### Phase C：补全工程闭环（性价比 ⭐⭐⭐）

#### C1. Docker 自托管方案
- **关键技术要点**：Dockerfile + docker-compose，KV 换 Redis/Postgres 适配层
- **价值量**：⭐⭐⭐——JD"Docker 部署"必备

#### C2. 浏览器内推理深化（WebGPU + Whisper）
- **关键技术要点**：本地小模型补全、本地 Whisper、WebGPU 加速
- **价值量**：⭐⭐⭐——前沿加分

#### C3. 向量数据库选型 benchmark 文档
- **关键技术要点**：Milvus vs Qdrant vs pgvector vs 本地方案对比
- **价值量**：⭐⭐⭐⭐——JD"向量数据库选型"高频

---

## 5. v2 · 12 周执行计划（重新排序）

> 核心变化：**前 3 周先写博客**（素材已齐，立即变现），再做 RAGAS 和重排。

| 周 | 任务 | 交付物 | 素材状态 | 面试价值 |
|---|---|---|---|---|
| W1 | **写博客 1：《local-first + 零信任多用户登录架构》** | 掘金/知乎链接 | ✅ 素材已齐 | ⭐⭐⭐⭐⭐ |
| W2 | **写博客 2：《从 0 到 1 写标准 MCP Server》** | 文章链接 | ✅ 素材已齐 | ⭐⭐⭐⭐⭐ |
| W3 | **写博客 3：《混合检索的坑：维度不匹配 bug 复盘》** | 文章链接 | ✅ 真实 bug | ⭐⭐⭐⭐⭐ |
| W4 | RAGAS 评估体系 + 测试集 | `tests/eval/` + eval 报告 | 需新建 | ⭐⭐⭐⭐⭐ |
| W5 | Cross-Encoder 重排 + Python FastAPI | `services/rerank/` + Dockerfile | 需新建 | ⭐⭐⭐⭐ |
| W6 | 写博客 4：《RAGAS 实战》 | 文章链接 | W4 后写 | ⭐⭐⭐⭐⭐ |
| W7 | Agent 可观测性 + 失败模式报告 | OTel + `docs/agent-failure-modes.md` | 需新建 | ⭐⭐⭐⭐⭐ |
| W8 | HNSW 本地向量索引 + benchmark | `src/lib/ai/hnsw.ts` + 报告 | 需新建 | ⭐⭐⭐⭐ |
| W9 | 多 Agent 协作（Supervisor） | `src/lib/ai/agent/multi-agent.ts` | 需新建 | ⭐⭐⭐⭐ |
| W10 | Docker 自托管 + 向量 DB 选型文档 | `docker-compose.yml` + 选型报告 | 需新建 | ⭐⭐⭐⭐ |
| W11 | 浏览器内推理深化（WebGPU） | `src/lib/ai/local-inference.ts` | 需新建 | ⭐⭐⭐ |
| W12 | 简历重构 + README 重写 | 简历 + README | - | ⭐⭐⭐⭐⭐ |

**关键调整**：W1-W3 直接写博客——代码已经够强（108 测试 + MCP + 零信任 + OpenAPI），现在最缺的是"让面试官看到"。

---

## 6. 简历呈现模板（v2 · 12 周后）

```
Mnemosyne · AI 时代的 local-first 云笔记
https://github.com/soulor8908/mnemosyne-ai

技术栈：Next.js 15 / React 19 / TypeScript / Dexie/IndexedDB / Cloudflare Workers + KV /
       Vercel AI SDK / Workers AI / @xenova/transformers / @modelcontextprotocol/sdk /
       ts-fsrs / Zod / Vitest(108 tests) / Playwright / OpenAPI 3.1

核心能力（对齐 AI 应用工程师 JD）：
- 标准 MCP Server：stdio 传输，4 工具（capture/embed/ask/search），Claude Desktop 可直连
  · 纯逻辑客户端，可注入测试，含本地导出检索（数据不出本机）
  · 详见博客：https://...
- 零信任多用户认证：SCRAM-lite 挑战应答，masterKey 永不上传，verifier 存储
  · 双令牌鉴权（SYNC_TOKEN + 会话），sha256 时序安全比较，fail-closed
  · 详见博客：https://...
- RAG 全流程：混合检索（关键词+向量+RRF）+ Cross-Encoder 重排 + RAGAS 评估
  · 修复过 query 嵌入维度不匹配导致语义检索失效的真实 bug
  · 自建测试集，faithfulness 0.82，详见博客：https://...
- Agent 工作流：夜间 Agent + 幂等键 + OTel 轨迹追踪 + 失败模式分析
  · 沉淀"Agent 失败模式 Top 10"报告
- 向量检索工程：浏览器内 HNSW + int8 量化，benchmark 对比 Milvus/Qdrant/pgvector
- Local-First：Dexie 本地真理 + KV 加密备份 + 字段级合并 + 冲突快照
- 网页剪藏：服务端抓取 + 纯函数正文提取（无 DOM 依赖，Workers 可跑）
- 质量工程：14 测试文件 / 108 用例 / 4 层门禁 / GitHub Actions CI
- OpenAPI 3.1 规范：全端点文档化，E2E 加密边界明确

技术博客：
1. 《local-first + 零信任多用户登录的云笔记架构》
2. 《从 0 到 1 写一个标准 MCP Server》
3. 《混合检索的坑：维度不匹配 bug 复盘》
4. 《RAGAS 实战：给 RAG 系统装上仪表盘》
```

---

## 7. 风险与取舍（v2）

| 风险 | 应对 |
|---|---|
| 12 周做不完 | W1-W3 博客必做（素材已齐），W4 后按优先级砍 |
| 博客写不出来 | 代码已有，照着代码讲就行，不用憋大招 |
| Python 不熟 | W5 重排服务就是练手，做出来就有底气 |
| RAGAS 测试集难建 | 从 inbox/ 里已有的飞书捕获笔记抽，50 条够用 |
| MCP 已做完还要做什么 | 写博客 + 接 Cross-Encoder 重排 + 接 RAGAS 评估，深化而非重做 |

---

## 8. 卡帕西式总结（v2）

> v1 说"5 个反主流决策"，v2 已经验证了其中 3 个：
> 1. ✅ **local-first 反 SaaS**——已落地，Dexie + KV 同步
> 2. ✅ **零信任是 ToB 级**——已升级到多用户 SCRAM-lite
> 3. ✅ **MCP 暴露而非封闭**——已落地标准 stdio server
> 4. ⏳ **RAGAS 评估而非感觉**——待做（W4）
> 5. ⏳ **Agent 可观测而非黑盒**——待做（W7）
>
> v2 的核心洞察：**代码已经够强，缺的是"被看见"**。
> 108 个测试、标准 MCP、零信任多用户——这些在简历上不写出来，面试官根本不知道。
> 所以 v2 把"写博客"从最后挪到最前：W1-W3 直接把已有代码变成 3 篇博客。
>
> 一个有 108 个测试 + 标准 MCP Server + 零信任认证 + 3 篇深度博客的候选人，
> 在 2026 年的 AI 工程师市场已经超过 80% 的竞争者。

---

## 9. 立即开始的第一步（v2）

**本周（W1）就写第一篇博客：《local-first + 零信任多用户登录的云笔记架构》**。

素材已齐：
- [src/lib/auth/zerotrust.ts](file:///workspace/src/lib/auth/zerotrust.ts) — SCRAM-lite 挑战应答
- [src/lib/auth/guard.ts](file:///workspace/src/lib/auth/guard.ts) — 双令牌鉴权
- [src/lib/auth/session.ts](file:///workspace/src/lib/auth/session.ts) — session 管理
- [src/lib/crypto/index.ts](file:///workspace/src/lib/crypto/index.ts) — BIP39 + AES-GCM
- [src/lib/sync/engine.ts](file:///workspace/src/lib/sync/engine.ts) — 加密同步

写作大纲：
1. 为什么 local-first（反 SaaS 主流）
2. 零信任的挑战：masterKey 不能上传，怎么登录？
3. SCRAM-lite 方案：verifier + challenge + response
4. 双令牌鉴权：兼容遗留 SYNC_TOKEN + 多用户会话
5. 加密同步：字段级合并 + 冲突快照
6. 踩过的坑：曾用 header 透传 masterKey，后删除

写完发掘金/知乎，简历挂链接。这一步做完，后面 11 周就有节奏了。
