# Mnemosyne AI

> 让 AI 替你维护知识库，让你的思考永不丢失，并永远属于你自己。

一个 **local-first 的 AI 云笔记**。数据的真理之源在你的浏览器（IndexedDB），云端只保存端到端加密后的备份；AI 负责帮你检索、串联和复习知识，而不是替你写作。

## 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                       客户端（浏览器）                         │
│                                                             │
│  助记词（12 词，BIP39）── PBKDF2 ──► MASTER_KEY（256-bit）    │
│       │                                                     │
│       ├──► AES-GCM 加密 ──► Dexie/IndexedDB（本地真理）       │
│       ├──► SCRAM-lite 登录（masterKey 永不出客户端）           │
│       └──► 向量检索（HNSW / 全量余弦，本地推理）               │
│                                                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS（只传 verifier/密文/令牌）
                       ▼
┌─────────────────────────────────────────────────────────────┐
│            Cloudflare Workers + KV / Docker 自托管            │
│                                                             │
│  零信任认证 │ 加密同步 │ MCP Server │ RAGAS 评估 │ Agent       │
│  ⚠️ 服务端从未持有 masterKey，无法解密任何笔记内容             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 已实现能力

### 数据层

| 能力 | 说明 | 代码 |
|---|---|---|
| 本地笔记 | Dexie/IndexedDB，版本化 schema（v3），置顶/排序/附件 | [src/lib/db/](src/lib/db/) |
| 端到端加密 | AES-GCM + PBKDF2（10万次），云端只见密文 | [src/lib/crypto/](src/lib/crypto/) |
| BIP39 助记词 | 12 词生成/校验（含 checksum）/派生主密钥，跨设备恢复 | [src/lib/crypto/index.ts](src/lib/crypto/index.ts) |
| 加密同步 | 密文 delta 上传 KV，字段级合并 + 冲突快照 | [src/lib/sync/engine.ts](src/lib/sync/engine.ts) |

### 认证层

| 能力 | 说明 | 代码 |
|---|---|---|
| 零信任多用户登录 | SCRAM-lite 挑战应答，masterKey 永不上传，verifier 存储 | [src/lib/auth/zerotrust.ts](src/lib/auth/zerotrust.ts) |
| 双令牌鉴权 | SYNC_TOKEN（遗留）+ 会话令牌，sha256 时序安全比较，fail-closed | [src/lib/auth/guard.ts](src/lib/auth/guard.ts) |
| 审计日志 | 登录/操作可追溯，90 天 TTL | [src/lib/auth/session.ts](src/lib/auth/session.ts) |

### AI 层

| 能力 | 说明 | 代码 |
|---|---|---|
| 混合检索 | 关键词 + 语义向量 + RRF 融合，模型严格过滤防维度混用 | [src/lib/ai/search.ts](src/lib/ai/search.ts) |
| HNSW 索引 | 纯 TS 实现 HNSW 近似最近邻，O(log n) 查询，召回率 96-100% | [src/lib/ai/hnsw.ts](src/lib/ai/hnsw.ts) |
| Cross-Encoder 重排 | Python FastAPI 服务，bge-reranker-v2-m3，候选 top-20 重排 top-5 | [services/rerank/](services/rerank/) |
| RAGAS 评估 | 4 指标（faithfulness/relevancy/recall/precision）+ 35 条测试集 + LLM-as-Judge | [src/lib/ai/eval/](src/lib/ai/eval/) |
| 夜间 Agent | 双链提议（向量余弦）+ 复习卡生成（LLM）+ 幂等键 | [src/lib/ai/agent/runner.ts](src/lib/ai/agent/runner.ts) |
| 多 Agent 协作 | Supervisor 模式：Collector → Reviewer → Writer，状态机编排 + 降级 | [src/lib/ai/agent/multi-agent.ts](src/lib/ai/agent/multi-agent.ts) |
| Agent 可观测性 | 7 step 轨迹追踪 + 失败模式聚合分析 | [src/lib/db/agent-traces.ts](src/lib/db/agent-traces.ts) |
| 网页剪藏 | 服务端抓取 + 纯函数正文提取（无 DOM 依赖，Workers 可跑） | [src/lib/ai/grounding.ts](src/lib/ai/grounding.ts) |
| 浏览器内推理 | WebGPU 优先 + WASM 降级，@xenova/transformers 本地嵌入 | [src/lib/ai/local-inference.ts](src/lib/ai/local-inference.ts) |
| 间隔重复 | FSRS 算法复习卡 | [src/lib/fsrs/](src/lib/fsrs/) |

### 开放层

| 能力 | 说明 | 代码 |
|---|---|---|
| MCP Server | 标准 stdio + 4 工具（capture/embed/ask/search），Claude Desktop 可直连 | [src/mcp/server.ts](src/mcp/server.ts) |
| OpenAPI 3.1 | 全端点文档化，Bearer 鉴权，E2E 加密边界 | [openapi.yaml](openapi.yaml) |
| 飞书捕获 | 飞书分享 → AI 总结 → inbox markdown → 导入 | [src/lib/inbox/](src/lib/inbox/) |

### 工程层

| 能力 | 说明 | 代码 |
|---|---|---|
| 质量工程 | 19 测试文件 / 166 用例 / 4 层门禁 / GitHub Actions CI | [tests/](tests/) |
| Docker 自托管 | docker-compose 三服务（web + redis + rerank），数据主权完全自主 | [docker-compose.yml](docker-compose.yml) |
| 多模型路由 | DeepSeek / GLM / OpenAI BYOK 优先，免费层降级 | [src/lib/ai/providers/](src/lib/ai/providers/) |

## 技术栈

**前端**：Next.js 15 · React 19 · TypeScript · Tailwind 3 · Dexie/IndexedDB

**AI**：Vercel AI SDK · Workers AI · @xenova/transformers · @modelcontextprotocol/sdk · ts-fsrs

**后端**：Cloudflare Workers + KV + R2 · Python FastAPI（重排服务）

**工程**：Vitest（166 tests）· Playwright · ESLint · OpenAPI 3.1 · Docker Compose

## 快速开始

### Cloudflare 部署

```bash
npm install
cp wrangler.toml.example wrangler.toml  # 填入 KV/R2/AI bindings
npm run dev                               # 本地开发
npm run deploy                            # 部署到 Workers
```

### Docker 自托管

```bash
cp .env.example .env  # 填入 SYNC_TOKEN、BYOK keys
docker-compose up -d  # 启动 web:3000 + redis:6379 + rerank:8001
```

详见 [docker/README.md](docker/README.md)。

### MCP Server 配置

Claude Desktop 的 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "mnemosyne": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "env": {
        "MNEMOSYNE_BASE_URL": "https://your-app.workers.dev",
        "MNEMOSYNE_TOKEN": "<会话令牌>"
      }
    }
  }
}
```

## 技术博客

每篇都有真实代码 + 真实踩坑，发掘金/知乎后简历挂链接。

1. [Local-First + 零信任多用户登录的云笔记架构](docs/blog/01-local-first-zerotrust-architecture.md)
2. [从 0 到 1 写一个标准 MCP Server](docs/blog/02-mcp-server-from-scratch.md)
3. [混合检索的坑：维度不匹配 bug 复盘](docs/blog/03-hybrid-search-dimension-mismatch-bug.md)
4. [RAGAS 实战：给 RAG 系统装上仪表盘](docs/blog/04-ragas-evaluation-in-practice.md)

## 设计文档

- [产品设计](docs/PRODUCT_DESIGN.md) · [技术设计](docs/TECHNICAL_DESIGN.md)
- [飞书捕获设计](docs/superpowers/specs/2026-07-29-feishu-share-capture-design.md)
- [向量数据库选型](docs/vector-db-selection.md)
- [Agent 失败模式分析](docs/agent-failure-modes.md)
- [找工作练兵场规划](docs/CAREER_DRILL_PLAN.md)

## 项目状态

个人项目，pre-alpha。下表如实区分"已实现"与"设计中"。

**已实现**：上表所有能力均有代码 + 测试覆盖（166 用例）。

**设计中**：浏览器内 Whisper 语音转写、移动端 PWA、协作编辑、加密密钥轮换。

## License

MIT
