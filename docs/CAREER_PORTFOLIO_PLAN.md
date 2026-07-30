# 五项目找工作练兵场 · Portfolio Plan v3

> 把 [Mnemosyne](https://github.com/soulor8908/mnemosyne-ai)（当前仓库）、[accounting-ai](https://github.com/soulor8908/accounting-ai)、[wordflow-ai](https://github.com/soulor8908/wordflow-ai)、[devpath-ai](https://github.com/soulor8908/devpath-ai)、[Hunter-AI](https://github.com/soulor8908/Hunter-AI) 五个项目当成一个整体作品集来规划。
>
> 视角：卡帕西式技术取向 + 乔布斯式产品取向 + 2026 年 1200+ AI 工程师 JD 反向映射。
>
> 配套：单项目视角的 [CAREER_DRILL_PLAN.md](./CAREER_DRILL_PLAN.md) v2 仍然有效，本文是 v3 多项目整合视角。

---

## 0. 一句话定位（求职版）

**五项目 = 一个"AI 应用工程师"的完整能力矩阵**——前端全栈 / local-first / RAG 全链路 / Agent 工作流 / MCP 生态 / 工程化交付 / 算法落地 / 安全工程 / 文档解析 / 内容工程，每一格都有一段可演示的代码 + 一篇可挂简历的博客。

5 个项目不是 5 个独立玩具，而是**一个能力的 5 个切面**。面试时按 JD 关键词切片，哪格命中就讲哪格。

---

## 1. 五项目矩阵全景（代码现状重扫）

| 项目 | 业务领域 | 核心技术栈 | 差异化亮点 | 求职角色 |
|---|---|---|---|---|
| **Mnemosyne**（本仓库） | AI 云笔记 / 知识库 | Next.js 15 + CF Workers + Dexie + KV/R2 + Vercel AI SDK + @xenova + MCP SDK + ts-fsrs + Python FastAPI | 混合检索 RRF + HNSW + Cross-Encoder 重排 + RAGAS + 多 Agent + Agent 可观测 + 零信任 SCRAM-lite + BIP39 + 网页剪藏 + OpenAPI + Docker | **旗舰**：RAG / Agent / MCP 深度 |
| **devpath-ai** | AI 开发者成长 OS | Next.js + CF Pages + Dexie + KV + AI SDK + ts-fsrs + Playwright + recharts | 知识图谱 YAML + 能量回归自研算法（8 维特征 + sin/cos 时段编码 + 每周重训练）+ 内容工程 4 层门禁 | **第二旗舰**：算法 + 内容工程 |
| **accounting-ai** | 自然语言记账 | React 18 + Vite 6 + Web Crypto + CF Pages + Worker 代理 | 自然语言解析引擎（金额/日期/账户/分类）+ 分期/贷款计算 + 多路密钥包装保险库 + AI 记忆去重 + IP 限流代理 | 安全工程 + NL 解析样板 |
| **wordflow-ai** | 英语词典 / 学习 | Next.js 16 + CF Pages + Dexie + KV + ts-fsrs + AI SDK | FSRS v5 + 词典数据懒加载 + BYOK + 刷题模式 + 常错词统计 | 算法落地 + PWA 离线样板 |
| **Hunter-AI** | 求职 Agent | React 18 + Vite 5 + PWA + idb + Zustand + jsPDF + pdfjs-dist + mammoth + html2canvas | JD 解析 + 简历生成 + PDF/Word 双向解析 + 截图导出 | 文档解析 + 多模态样板 |

**共同基础设施栈**（5 项目互相验证）：TypeScript 全栈 / local-first IndexedDB / Cloudflare 边缘部署 / Vercel AI SDK / ts-fsrs / Zod / Vitest / Husky 门禁。

---

## 2. 技术栈与知识点深挖地图

### 2.1 已落地技术栈（可直接在简历上写）

| 层级 | 技术点 | 落地项目 | 深挖价值 |
|---|---|---|---|
| **前端框架** | Next.js 15/16 App Router / React 19 / Vite 6 | 全部 | 中（已饱和） |
| **本地存储** | Dexie / IndexedDB / idb-keyval / idb | 全部 | 高（local-first 是反主流决策） |
| **边缘运行时** | Cloudflare Workers / Pages / KV / R2 / Workers AI / Cron | Mnemosyne / devpath / wordflow | 高（反 AWS 中心化） |
| **AI 编排** | Vercel AI SDK 3.4/7.0 + Zod schema | 全部 | 高（但缺 LangChain，见 §3） |
| **RAG 检索** | 关键词 + 语义 + RRF 融合 + 模型严格过滤 + 降级 | Mnemosyne | **极高** |
| **向量索引** | 纯 TS HNSW + int8 量化 + 全量余弦 | Mnemosyne | 高 |
| **重排** | Cross-Encoder bge-reranker-v2-m3 | Mnemosyne | 高 |
| **RAG 评估** | RAGAS 4 指标 + 35 测试集 + LLM-as-Judge | Mnemosyne | **极高** |
| **Agent 工作流** | 夜间 Agent + 幂等键 + 提议收件箱 | Mnemosyne | **极高** |
| **多 Agent** | Supervisor 模式（Collector→Reviewer→Writer）+ 状态机 + 降级 | Mnemosyne | **极高** |
| **Agent 可观测** | 7 step 轨迹追踪 + 失败模式聚合 | Mnemosyne | **极高** |
| **MCP Server** | stdio 传输 + 4 工具（capture/embed/ask/search）+ 纯逻辑客户端 | Mnemosyne | **极高** |
| **零信任认证** | SCRAM-lite + BIP39 助记词 + 双令牌 + sha256 时序安全 + fail-closed | Mnemosyne | **极高** |
| **加密工程** | AES-GCM 256 + PBKDF2 600k + 多路密钥包装（密码/安全问题/恢复码） | Mnemosyne / accounting | **极高** |
| **加密同步** | 字段级合并 + 冲突快照 + delta + 30 天 TTL | Mnemosyne | 高 |
| **自然语言解析** | 金额/日期/账户/分类口语化解析 + 分期/贷款等额本息/本金 | accounting | 高 |
| **FSRS 算法** | ts-fsrs 4.5/4.7 + 3 种预设 + 热力图 | devpath / wordflow | 中 |
| **自研算法** | 8 维能量回归 + sin/cos 时段编码 + 每周重训练 | devpath | **极高** |
| **内容工程** | YAML 源 + compile/validate/freshness 4 层门禁 | devpath / wordflow | 高 |
| **文档解析** | pdfjs-dist + mammoth + html2canvas + jsPDF | Hunter | 高 |
| **网页剪藏** | 服务端抓取 + 纯函数正文提取（无 DOM 依赖） | Mnemosyne | 中 |
| **浏览器内推理** | @xenova/transformers + WebGPU 优先 + WASM 降级 | Mnemosyne / devpath | 高 |
| **OpenAPI** | 3.1.0 全端点 + Bearer + E2E 加密边界 | Mnemosyne | 中 |
| **Docker** | docker-compose 三服务（web + redis + rerank） | Mnemosyne | 中 |
| **CI/CD** | GitHub Actions + 4 层门禁 + Cloudflare Pages 自动部署 | 全部 | 高 |
| **质量工程** | Vitest 166+ 用例 + Playwright + fake-indexeddb | Mnemosyne / devpath | 高 |
| **多 provider 路由** | DeepSeek / GLM / OpenAI / Workers AI BYOK 优先 | 全部 | 中 |

### 2.2 知识点深挖清单（每个都可写成一篇博客）

| 主题 | 深挖点 | 落地项目 |
|---|---|---|
| **RAG 全链路** | chunking 策略 / embedding 选型 / RRF 调参 / 重排阈值 / 无答案检测 | Mnemosyne |
| **Agent 失败模式** | 幻觉双链 / 置信度漂移 / token 超限 / 工具循环 / handoff 协议 | Mnemosyne |
| **零信任加密** | masterKey 永不上传 / SCRAM-lite 挑战应答 / nonce 防重放 / 审计日志 | Mnemosyne |
| **多路密钥包装** | 密码 / 安全问题 / 恢复码三路包装 + PBKDF2 600k | accounting |
| **HNSW 调参** | M / efConstruction / efSearch 召回率 vs 延迟权衡 | Mnemosyne |
| **能量回归** | 8 维特征工程 + 时段 sin/cos 编码 + 多巴胺干扰 + 在线重训练 | devpath |
| **FSRS 调度** | 3 种预设（0.95/0.9/0.8）+ 遗忘曲线 + 间隔重复数学模型 | devpath / wordflow |
| **Worker 限流代理** | IP 限流 + 白名单 + Key 注入 + 用户自有 Key 直连 | accounting |
| **YAML 内容工程** | 模板版本化 / 新鲜度审计 / 编译产物 / 4 层门禁 | devpath / wordflow |
| **PDF/Word 解析** | pdfjs-dist + mammoth + 反向生成 jsPDF | Hunter |
| **MCP 协议** | stdio 传输 / tool schema / Claude Desktop 集成 / 纯逻辑客户端 | Mnemosyne |

---

## 3. JD 匹配度矩阵（2026 年 1200+ JD 反向映射）

> 数据来源：Boss / 牛客 / 智联 / 飞书招聘 / Built In / Scaler 2026 AI Engineer 报告 / CSDN 50+ JD 分析。

| JD 高频要求 | 提及率 | 5 项目现状 | 匹配度 | 缺口 |
|---|---|---|---|---|
| **RAG 全流程** | 40.2% | ✅ Mnemosyne 混合检索 + RRF + 重排 + RAGAS | **85%** | chunking 策略文档化、多模态 RAG |
| **Prompt Engineering** | 31.5% | ✅ 5 项目都有，devpath YAML 版本化最完整 | 75% | A/B 测试、回归测试集 |
| **Agents / Agentic AI** | 18.7% | ✅ Mnemosyne 多 Agent + 可观测，accounting 工具调用 | **80%** | ReAct/Plan-Execute 论文化 |
| **LangChain / LangGraph** | 19.1% / 9.8% | ❌ **5 项目全部用 Vercel AI SDK** | **20%** | **头号战略缺口** |
| **向量数据库**（Milvus/Qdrant/Chroma） | 高频 | ⚠️ 全部本地 idb-keyval / HNSW | 40% | 工业级向量 DB benchmark |
| **MCP** | 5.8%（新增，上升） | ✅ Mnemosyne 标准 MCP Server | **95%** | 多项目 MCP 生态 |
| **Function Calling / Tool Use** | 必备 | ✅ accounting / Mnemosyne / devpath | 85% | MCP 扩展 |
| **LLMOps / 评估** | 高频 | ✅ Mnemosyne RAGAS + Agent trace | 60% | Langfuse/LangSmith 工业级 |
| **Python** | 必备 | ⚠️ Mnemosyne rerank 一个服务 | 35% | **Python 后端深度不足** |
| **TypeScript** | 加分 | ✅ 5 项目全部精通 | **95%** | 无 |
| **Docker / K8s** | 高频 | ✅ Mnemosyne docker-compose | 60% | K8s manifest、Helm |
| **企业系统集成** | 高频 | ✅ Mnemosyne 飞书捕获 | 50% | 多系统集成（OA/钉钉/Slack） |
| **微调（LoRA/PEFT）** | 加分 | ❌ 全无 | 10% | 小模型微调一次 |
| **知识图谱（Neo4j）** | 加分 | ⚠️ devpath YAML 图，非图数据库 | 30% | 引入 Kuzu/Neo4j |
| **可观测性（Langfuse/LangSmith/Phoenix）** | 加分 | ⚠️ Mnemosyne 自研 trace | 50% | 接入工业级 |
| **多模态** | 加分 | ⚠️ Hunter 文档解析 | 40% | 文生图/语音 |
| **从 0 到 1 落地** | 必备 | ✅ 5 项目完整闭环 | **95%** | 无 |
| **技术博客 / 开源** | 加分 | ⚠️ Mnemosyne 4 篇 | 50% | 跨项目博客矩阵 |
| **A2A 协议** | 新增 | ❌ 全无 | 0% | 多 Agent 跨项目协作 |

**总体匹配度：约 72%**（单看 Mnemosyne 已达 78%，但跨项目反而被 LangChain 缺口拉低，因为 5 个项目都没用 LangChain）。

**剩余硬通货缺口（按战略优先级）**：
1. **LangChain / LangGraph**（20% → 必须补，工业界 90% 企业在用）
2. **Python 后端深度**（35% → 必须补，Python 是 AI 岗必备）
3. **工业级向量数据库**（40% → 补 benchmark 一次）
4. **工业级可观测性**（50% → 接 Langfuse 一次）
5. **LoRA 微调**（10% → 加分项，做一次）
6. **知识图谱**（30% → 加分项）
7. **A2A 协议**（0% → 前沿加分）

---

## 4. 五项目各自的深挖方向

### 4.1 Mnemosyne（旗舰）—— RAG / Agent / MCP 深度

**深挖点**：
- RAG chunking 策略对比（固定 / 语义 / 递归 / 重叠）+ benchmark
- RRF k 参数调优曲线
- Cross-Encoder 候选数 top-20 vs top-50 的延迟 / 召回权衡
- Agent 失败模式 Top 10 报告（幻觉双链 / 置信度漂移 / 工具循环）
- HNSW M / efConstruction / efSearch 召回率 vs 延迟三维 benchmark
- 多 Agent Supervisor 状态机的 handoff 协议设计
- 零信任 SCRAM-lite 的安全分析（对比 SRP / OPAQUE）

**深耕点**：
- 接入 Langfuse 替换自研 trace（工业级可观测）
- 引入 Qdrant / Milvus benchmark 对比本地 HNSW
- 在 rerank 服务基础上扩展 Python 微服务群（embedding / chunking / eval 分离）

### 4.2 devpath-ai（第二旗舰）—— 算法 + 内容工程

**深挖点**：
- 能量回归 8 维特征的消融实验（ablation study）
- sin/cos 时段编码 vs one-hot 时段编码对比
- 每周重训练的漂移检测
- YAML 知识图谱 → Neo4j / Kuzu 图数据库迁移
- 4 层门禁的工程化沉淀（可独立开源为 npm 包）

**深耕点**：
- 引入 LangGraph 重写知识拆解 Agent（补 LangChain 缺口）
- 能量回归模型用 Python + scikit-learn 重写（补 Python 缺口）
- 知识图谱节点接 RAG（图增强检索，2026 年高频加分项）

### 4.3 accounting-ai —— 安全工程 + NL 解析

**深挖点**：
- 多路密钥包装的安全分析（密码 / 安全问题 / 恢复码三路冗余）
- PBKDF2 600k 轮 vs Argon2id 对比
- 自然语言解析引擎的歧义消解（"转 500 到招行" 的指代问题）
- AI 记忆去重的相似度阈值调优
- Worker 限流代理的并发安全（内存 Map vs Durable Objects）

**深耕点**：
- 用 LoRA 微调一个小模型（Qwen2.5-0.5B / Phi-3-mini）专门做记账分类
- 把解析引擎用 Python + FastAPI 重写（补 Python 缺口）

### 4.4 wordflow-ai —— 算法落地 + PWA

**深挖点**：
- FSRS v5 vs SM-2 vs Anki 默认算法的对比 benchmark
- 词典数据懒加载的分块策略
- 常错词统计的遗忘曲线建模

**深耕点**：
- 用 LoRA 微调一个发音评估小模型（多模态加分）
- 接 LangChain 做一个"AI 造例句" Agent（补 LangChain 缺口）

### 4.5 Hunter-AI —— 文档解析 + 多模态

**深挖点**：
- pdfjs-dist / mammoth / html2canvas 的解析边界情况
- JD 解析的结构化抽取（Zod schema）
- jsPDF 反向生成的排版稳定性

**深耕点**：
- 引入 OCR（Tesseract.js / Paddle.js）补扫描件 PDF
- 用 LangGraph 编排"JD 分析 → 简历匹配 → 生成 → 导出"多 Agent 流程
- 接入向量数据库做"历史 JD 相似度匹配"

---

## 5. 跨项目整合方向（5 个项目变成 1 个生态）

### 5.1 MCP 生态矩阵（⭐⭐⭐⭐⭐ 价值量最高）

每个项目都暴露一个标准 MCP Server，Claude Desktop / Cursor / TRAE 可直连：

```
Claude Desktop
    ├── mnemosyne-mcp   (capture/embed/ask/search)  ← 已落地
    ├── devpath-mcp     (learn/plan/review/quiz)    ← 待做
    ├── accounting-mcp  (record/query/budget/plan)  ← 待做
    ├── wordflow-mcp    (lookup/study/review)       ← 待做
    └── hunter-mcp      (parse-jd/match-resume/gen) ← 待做
```

**价值**：MCP 是 2026 年新增 JD 关键词（5.8% 且快速上升），5 个 MCP Server 组成的生态是**简历顶部的核武器**——"我不仅会用 MCP，我建了一个 MCP 生态"。

### 5.2 A2A 协议：跨项目 Agent 协作（⭐⭐⭐⭐ 前沿加分）

让 5 个项目的 Agent 互相对话：
- Hunter-AI 的 Agent 问 devpath-ai："候选人缺什么技能？"
- devpath-ai 的 Agent 问 Mnemosyne："相关笔记有哪些？"
- Mnemosyne 的 Agent 问 wordflow-ai："英语术语怎么解释？"

**价值**：A2A 是 2026 年新增协议，几乎没有候选人做过，**前沿加分项**。

### 5.3 统一可观测性：Langfuse 接入（⭐⭐⭐⭐ 工业级）

5 个项目全部接入 Langfuse，形成统一的 trace / cost / quality 看板。

**价值**：替换自研 trace，证明"我会用工业级 LLMOps 工具"，JD 原话"Langfuse / LangSmith / Phoenix"。

### 5.4 向量数据库 benchmark 报告（⭐⭐⭐⭐ 加分）

在 Mnemosyne 的真实数据集上对比：
- 本地 HNSW（已有）
- Qdrant（自托管 Docker）
- Milvus（自托管 Docker）
- Chroma（嵌入式）
- pgvector（Postgres 扩展）

输出一篇 benchmark 报告：召回率 / 延迟 / 内存 / 部署成本 / 运维复杂度五维对比。

**价值**：JD"向量数据库选型"高频，一份真实数据 benchmark 是 senior 信号。

### 5.5 LoRA 微调实验（⭐⭐⭐ 加分）

在 accounting-ai 上微调 Qwen2.5-0.5B 做记账分类：
- 标注 200 条数据
- LoRA 微调
- 对比微调前后的 F1
- 部署到 Mnemosyne 的 Docker（Ollama / vLLM）

**价值**：JD"微调 LLMs / SLMs using Hugging Face, PEFT, or LoRA"原话命中。

### 5.6 LangChain / LangGraph 引入（⭐⭐⭐⭐⭐ 头号战略缺口）

**必须做**。在 devpath-ai 或 Hunter-AI 上用 LangGraph 重写一个 Agent 流程：
- LangGraph StateGraph 定义节点 / 边 / 条件路由
- LangChain Tool / Memory / Retriever 接入
- 对比 Vercel AI SDK 的差异

**价值**：LangChain 19.1% + LangGraph 9.8%，工业界 90% 企业在用，**不补这个缺口，5 个项目都会被一票否决**。

---

## 6. 卡帕西视角：技术架构建议

> 卡帕西原则：**最小依赖 / 模型即代码 / 软件 2.0 / 数据即真理 / 边界校验**。

### 6.1 反主流决策已验证（继续坚持）

| 决策 | 状态 | 卡帕西论证 |
|---|---|---|
| local-first 反 SaaS | ✅ 5 项目一致 | 用户的思想/财务/学习轨迹不应默认在别人服务器上 |
| TypeScript 全栈 | ✅ 5 项目一致 | 端到端类型安全 > Python 后端 + TS 前端的割裂 |
| CF 边缘部署反 AWS | ✅ 5 项目一致 | 免费层 + 全球低延迟 + 零运维，个人项目最优解 |
| BYOK 优先 | ✅ 5 项目一致 | 用户数据不应成为平台变现资产 |
| AI SDK 反 LangChain | ⚠️ **需要修正** | Vercel AI SDK 工程化更干净，但工业界 LangChain 是事实标准——**不能反潮流，要双栈** |
| 模型即代码（prompt YAML 版本化） | ✅ devpath / Mnemosyne | prompt 是逻辑，应纳入 git / 可 diff / 可回滚 |
| 边界 Zod 校验 | ✅ 5 项目一致 | AI 输出不可信，必须在边界校验 |
| 依赖最小化 | ✅ 5 项目一致 | 每个依赖是未来负债 |

### 6.2 架构层面的深挖建议

1. **统一 SDK 抽象层**：在 5 项目共享一个 `@soulor8908/ai-sdk` 包，封装 provider 路由 / Zod schema / trace / cost，避免 5 份重复代码。
2. **Python 微服务群**：把 Mnemosyne 的 rerank 扩展成 `services/{rerank, embed, chunk, eval, finetune}` 五个 Python FastAPI 微服务，Docker Compose 编排——一次补齐 Python + Docker + 微服务三个缺口。
3. **评估即测试**：把 RAGAS 从 Mnemosyne 推广到 5 项目，每个 AI 功能都有 eval 集合，CI 跑 eval 回归——"我的 5 个项目都有 LLM 评估集"。
4. **trace 即文档**：Langfuse 接入后，每次 Agent 运行自动生成可分享的 trace 链接，面试时直接打开。
5. **HNSW 量化深化**：从 int8 量化到 int4 + PQ（Product Quantization），benchmark 写成博客——卡帕西式"我懂底层"。

### 6.3 反对的做法

- ❌ 为了补 LangChain 缺口把 5 项目全部重写——**只在 1-2 个项目引入，证明会用即可**
- ❌ 为了补 K8s 缺口给个人项目上 K8s——**过设计，Docker Compose 够用**
- ❌ 为了补微调缺口微调大模型——**微调 0.5B 小模型即可，证明懂流程**
- ❌ 为了补多模态加文生图——**Hunter-AI 的文档解析已经是多模态，深化即可**

---

## 7. 乔布斯视角：产品设计建议

> 乔布斯原则：**聚焦 / 简单 / 用户不关心技术 / 体验即产品 / 一句话讲清楚**。

### 7.1 五项目的产品问题（求职视角）

**当前问题**：5 个项目各自为战，面试官打开 GitHub 看到 5 个仓库，不知道你到底想说什么。

**乔布斯式解法**：**One More Thing**——把 5 个项目包装成一个"AI Personal OS"产品矩阵：

```
AI Personal OS · soulor8908
├── Mnemosyne   · 让 AI 替你维护知识库（记忆）
├── devpath-ai  · 让 AI 替你规划成长（学习）
├── accounting  · 让 AI 替你管钱（财务）
├── wordflow    · 让 AI 替你学英语（语言）
└── Hunter-AI   · 让 AI 替你找工作（求职）
```

**一句话定位**："我用一套 local-first + AI Agent 的技术栈，给一个人生活的 5 个维度都做了 AI 助手。"——面试官立刻记住。

### 7.2 每个产品的"一句话"

乔布斯法则：每个产品必须能用一句话讲清楚。

| 项目 | 当前定位 | 乔布斯式重写 |
|---|---|---|
| Mnemosyne | local-first 的 AI 云笔记 | **"让 AI 替你维护知识库，思考永不丢失"** |
| devpath-ai | AI-Native 开发者成长 OS | **"告诉 AI 你想学什么，它给你排好未来 3 个月"** |
| accounting-ai | 自然语言驱动个人财务管理 | **"一句话完成记账，AI 替你管钱"** |
| wordflow-ai | 查词即背词的英语词典 | **"查一次词，永远记住"** |
| Hunter-AI | 个人求职 Agent OS | **"粘贴 JD，30 秒生成专属简历"** |

### 7.3 体验即产品

5 个项目都要做到**打开就能用，不用配置**：
- BYOK 隐藏在"高级设置"里，默认走 Trial
- 第一次打开有 3 张引导卡，不是空白页
- 移动端 PWA 可装桌面（wordflow / Hunter 已做，其他补上）
- 暗色模式默认（程序员审美）

### 7.4 聚焦：砍掉什么

- 砍：5 个项目各自的设置页重复代码 → 抽成共享组件
- 砍：5 个项目各自的多 provider 路由 → 抽成共享 npm 包
- 砍：accounting 的分期/贷款等额本息/本金——**用户不需要知道你算了什么，只需要知道"下个月还 3500"**
- 砍：devpath 的能量回归 8 维特征 UI——**用户只需要看到"今天建议学 45 分钟"**

### 7.5 反对的做法

- ❌ 为了展示技术把 5 个项目首页都塞满技术名词——**用户不关心你用 HNSW 还是 RAGAS**
- ❌ 为了"完整"每个项目都做 10 个功能——**每个项目只做 1 个核心功能，做到极致**
- ❌ 为了"差异化"做反主流设计——**local-first 是手段不是目的，用户要的是"我的数据安全"**

---

## 8. 12-16 周执行 Plan（跨项目整合视角）

> 原则：**已完成的不再做，缺口大的优先做，性价比高的先做，跨项目整合 > 单项目深挖**。

### Phase A：补 JD 硬通货（W1-W4，性价比 ⭐⭐⭐⭐⭐）

| 周 | 任务 | 落地项目 | 交付物 | 价值量 |
|---|---|---|---|---|
| **W1** | **LangChain / LangGraph 引入**：用 LangGraph 重写 Hunter-AI 的"JD 分析→简历匹配→生成→导出"流程 | Hunter-AI | `src/agent/langgraph-flow.ts` + 博客《Vercel AI SDK vs LangGraph：我用同一个流程做了两遍》 | ⭐⭐⭐⭐⭐ |
| **W2** | **Langfuse 接入**：5 项目统一接入 Langfuse，替换自研 trace | 全部 | `packages/observability/` + Langfuse 看板截图 | ⭐⭐⭐⭐ |
| **W3** | **Python 微服务群**：Mnemosyne rerank 扩展为 `services/{rerank, embed, chunk, eval}` 四服务 | Mnemosyne | `docker-compose.yml` 升级 + 博客《从 1 个到 4 个：Python AI 微服务的拆分边界》 | ⭐⭐⭐⭐ |
| **W4** | **向量数据库 benchmark**：本地 HNSW vs Qdrant vs Milvus vs Chroma vs pgvector | Mnemosyne | `docs/vector-db-benchmark.md` + 五维对比表 + 博客 | ⭐⭐⭐⭐ |

### Phase B：跨项目生态（W5-W8，性价比 ⭐⭐⭐⭐）

| 周 | 任务 | 落地项目 | 交付物 | 价值量 |
|---|---|---|---|---|
| **W5** | **MCP 生态矩阵**：devpath / accounting / wordflow / Hunter 各暴露一个 MCP Server | 4 项目 | 4 个 `src/mcp/server.ts` + 博客《我用 5 个 MCP Server 组了一个 AI Personal OS》 | ⭐⭐⭐⭐⭐ |
| **W6** | **知识图谱深化**：devpath YAML 图迁移到 Kuzu（嵌入式图数据库），接 RAG 图增强检索 | devpath-ai | `src/lib/kg/` + 博客《Graph RAG 实战：从 YAML 到 Kuzu》 | ⭐⭐⭐⭐ |
| **W7** | **LoRA 微调**：accounting-ai 微调 Qwen2.5-0.5B 做记账分类 | accounting-ai | `services/finetune/` + F1 对比报告 + 博客《LoRA 微调 0.5B 小模型做记账分类的得与失》 | ⭐⭐⭐⭐ |
| **W8** | **A2A 协议原型**：5 项目 Agent 跨项目对话（Hunter 问 devpath 问 Mnemosyne） | 全部 | `packages/a2a/` + 演示视频 + 博客《A2A 协议：让 5 个 Agent 互相对话》 | ⭐⭐⭐ |

### Phase C：单项目深挖 + 博客矩阵（W9-W12，性价比 ⭐⭐⭐）

| 周 | 任务 | 落地项目 | 交付物 | 价值量 |
|---|---|---|---|---|
| **W9** | **Agent 失败模式报告**：Mnemosyne 多 Agent 上线 4 周后的失败模式 Top 10 | Mnemosyne | `docs/agent-failure-modes.md`（已有，深化） + 博客 | ⭐⭐⭐⭐⭐ |
| **W10** | **能量回归消融实验**：devpath 8 维特征逐个消融 | devpath-ai | `docs/energy-regression-ablation.md` + 博客 | ⭐⭐⭐ |
| **W11** | **RAG chunking 策略对比**：Mnemosyne 4 种 chunking + RAGAS 评估 | Mnemosyne | `docs/chunking-strategy.md` + 博客 | ⭐⭐⭐⭐ |
| **W12** | **简历重构 + README 矩阵重写**：5 项目 README 统一格式，挂博客链接 | 全部 | 5 个 README + 1 份简历 | ⭐⭐⭐⭐⭐ |

### Phase D（弹性，W13-W16，按精力砍）：⭐⭐⭐

| 周 | 任务 | 落地项目 |
|---|---|---|
| W13 | 浏览器内推理深化（WebGPU + Whisper 语音转写） | Mnemosyne |
| W14 | OCR 补扫描件 PDF（Tesseract.js / Paddle.js） | Hunter-AI |
| W15 | 共享 SDK 抽象层 `@soulor8908/ai-sdk` | 全部 |
| W16 | K8s manifest（把 docker-compose 升级到 K8s，证明会 K8s） | Mnemosyne |

---

## 9. 关键技术要点 / 核心注意点 / 性价比 / 价值量（一图速查）

| 任务 | 关键技术要点 | 核心注意点 | 性价比 | 价值量 |
|---|---|---|---|---|
| **LangGraph 引入** | StateGraph / 节点 / 边 / 条件路由 / Tool / Memory | 不要全量重写，只重写 1 个流程证明会用；对比 Vercel AI SDK 差异 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Langfuse 接入** | trace / span / cost / quality 看板 | 5 项目统一一个 Langfuse 实例；替换自研 trace 而非并存 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Python 微服务群** | FastAPI / Docker Compose / 服务间通信 | 微服务拆分边界按"模型 / 算法"切，不按"业务"切；embed/chunk/eval/rerank 四服务够用 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **向量 DB benchmark** | Qdrant / Milvus / Chroma / pgvector / 本地 HNSW | 真实数据集（Mnemosyne 笔记）；五维对比（召回/延迟/内存/成本/运维） | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **MCP 生态矩阵** | stdio / tool schema / Claude Desktop 集成 | 5 个 MCP Server 共享一个 `packages/mcp-sdk`；每个 4-6 个工具 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Graph RAG** | Kuzu / Neo4j / Cypher / 图增强检索 | 嵌入式 Kuzu 比 Neo4j 轻量，个人项目够用；图 + 向量混合检索是 2026 高频 | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **LoRA 微调** | PEFT / LoRA / Qwen2.5-0.5B / Ollama 部署 | 0.5B 小模型够用；标注 200 条即可；对比 F1 而非追求 SOTA | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **A2A 协议** | Agent Card / Task delegation / 跨项目通信 | 原型即可，不追求生产可用；演示视频比代码更有说服力 | ⭐⭐ | ⭐⭐⭐ |
| **Agent 失败模式报告** | 幻觉双链 / 置信度漂移 / 工具循环 / token 超限 | 真实数据（Langfuse trace）；Top 10 每个有复现步骤 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **能量回归消融** | 8 维特征逐个消融 / sin-cos vs one-hot | 消融实验是 senior 信号；写清 p-value 而非只看 R² | ⭐⭐⭐ | ⭐⭐⭐ |
| **chunking 对比** | 固定 / 语义 / 递归 / 重叠 + RAGAS 评估 | 4 种策略在同一个测试集上跑；画出 faithfulness 曲线 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **简历 + README 矩阵** | 5 项目 README 统一格式 / 博客链接 / 简历按 JD 切片 | 简历不要列 5 个项目，要按"RAG/Agent/MCP/工程化"4 个能力切片 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 10. 风险与取舍

| 风险 | 应对 |
|---|---|
| 16 周做不完 | Phase A（W1-W4）必做，Phase B 按精力砍，Phase C 博客优先 |
| LangChain 不熟 | W1 就是练手，Vercel AI SDK 已熟练，迁移成本低 |
| Python 不熟 | W3 微服务群 + W7 微调，两次练手就有底气 |
| 5 项目精力分散 | **Mnemosyne 旗舰 + devpath 第二旗舰**，其他 3 个只做 MCP Server + 博客，不深挖 |
| 博客写不出来 | 每个任务做完当周写，代码已有照着讲 |
| A2A 协议太前沿 | W8 是弹性任务，做不出原型就砍，不影响主线 |
| Langfuse 要付费 | 免费层 50k spans/月够个人项目用 |

---

## 11. 立即开始的第一步

**本周（W1）就做两件事**：

1. **在 Hunter-AI 上用 LangGraph 重写"JD 分析→简历匹配→生成→导出"流程**——补头号战略缺口
2. **写博客《Vercel AI SDK vs LangGraph：我用同一个流程做了两遍》**——对比双栈差异，一篇文章命中 LangChain 19.1% + LangGraph 9.8% 两个 JD 关键词

W1 做完，5 项目的 LangChain 缺口就补上了，后面 15 周的节奏就稳了。

---

## 12. 简历呈现模板（16 周后）

```
soulor8908 · AI 应用工程师
GitHub: github.com/soulor8908  ·  Blog: ...  ·  Langfuse: ...

AI Personal OS · 5 个 local-first AI 应用的技术矩阵
https://github.com/soulor8908  (Mnemosyne / devpath-ai / accounting-ai / wordflow-ai / Hunter-AI)

技术栈：TypeScript / Python / Next.js 15-16 / React 19 / Cloudflare Workers + KV + R2 /
       Vercel AI SDK 7 + LangGraph / @xenova/transformers / @modelcontextprotocol/sdk /
       ts-fsrs / Zod / FastAPI / Docker Compose / Langfuse / RAGAS / Vitest(200+ tests) /
       Playwright / OpenAPI 3.1 / Qdrant / Milvus / Kuzu / LoRA

核心能力（对齐 2026 AI 应用工程师 JD）：

· RAG 全链路：混合检索（关键词+向量+RRF）+ Cross-Encoder 重排 + RAGAS 评估 + chunking 策略对比
  · 自建 35 条测试集，faithfulness 0.82，修复过 query 嵌入维度不匹配 bug
  · 向量 DB benchmark：本地 HNSW vs Qdrant vs Milvus vs Chroma vs pgvector 五维对比
  · 详见博客：https://...

· Agent 工作流：多 Agent Supervisor（Collector→Reviewer→Writer）+ 幂等键 + 失败模式分析
  · LangGraph 状态机编排 + Langfuse 工业级 trace
  · 沉淀"Agent 失败模式 Top 10"报告
  · A2A 协议：5 个项目的 Agent 跨项目协作原型
  · 详见博客：https://...

· MCP 生态：5 个标准 MCP Server（capture/learn/record/lookup/hunt），Claude Desktop 可直连
  · 详见博客：https://...

· LLM 评估：RAGAS 4 指标 + LLM-as-Judge + 5 项目 eval 集合 + CI 回归
  · 详见博客：https://...

· LoRA 微调：Qwen2.5-0.5B 微调做记账分类，F1 0.78→0.86
  · 详见博客：https://...

· 零信任安全：SCRAM-lite + BIP39 + 多路密钥包装 + PBKDF2 600k
  · 详见博客：https://...

· Local-First：Dexie + KV 加密同步 + 字段级合并 + 冲突快照
  · 详见博客：https://...

· 算法落地：能量回归 8 维特征 + 消融实验 / FSRS v5 3 预设 / HNSW int8 量化
  · 详见博客：https://...

· 工程化：Docker Compose / Python 微服务群 / OpenAPI 3.1 / 4 层门禁 / 200+ 测试
  · 详见博客：https://...

技术博客（10+ 篇）：
1. 《local-first + 零信任多用户登录的云笔记架构》
2. 《从 0 到 1 写一个标准 MCP Server》
3. 《混合检索的坑：维度不匹配 bug 复盘》
4. 《RAGAS 实战：给 RAG 系统装上仪表盘》
5. 《Vercel AI SDK vs LangGraph：我用同一个流程做了两遍》
6. 《5 个 MCP Server 组了一个 AI Personal OS》
7. 《向量数据库五维 benchmark：本地 HNSW vs Qdrant vs Milvus vs Chroma vs pgvector》
8. 《LoRA 微调 0.5B 小模型做记账分类的得与失》
9. 《Agent 失败模式 Top 10》
10. 《Graph RAG 实战：从 YAML 到 Kuzu》
```

---

## 13. 卡帕西式总结（v3）

> v2 说"代码已经够强，缺的是被看见"。
>
> v3 的核心洞察：**5 个项目不是 5 个独立作品，是一个能力的 5 个切面**。
>
> 单看 Mnemosyne 匹配度 78%，但 5 项目整合后**暴露了两个战略缺口**：
> 1. **LangChain / LangGraph 完全缺失**——工业界 90% 企业在用，不补会被一票否决
> 2. **Python 后端深度不足**——只有 rerank 一个服务，Python 是 AI 岗必备
>
> v3 的核心动作：**W1 立刻补 LangGraph，W3 立刻补 Python 微服务群**，这两个缺口补上，5 项目就从"5 个 TS 项目"变成"双栈 + 生态"。
>
> v3 的核武器：**MCP 生态矩阵**——5 个 MCP Server 组成的 AI Personal OS，是 2026 年简历顶部的差异化武器。
>
> 一个有 5 个 local-first AI 应用 + 5 个 MCP Server + LangGraph 双栈 + Python 微服务群 + LoRA 微调 + 10 篇深度博客的候选人，在 2026 年的 AI 工程师市场已经超过 95% 的竞争者。
