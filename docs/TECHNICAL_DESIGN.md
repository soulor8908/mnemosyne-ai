# Mnemosyne · 技术设计文档

> 基于 [devpath-ai](https://github.com/soulor8908/devpath-ai) 已在生产验证的技术栈，落地 AI 时代云笔记产品。
>
> 设计哲学来源：卡帕西视角主导架构与工程取向（local-first、软件 2.0、最小依赖、模型即代码）。
>
> 配套文档：[产品设计文档](./PRODUCT_DESIGN.md)

---

## 0. 技术栈基线（严格对齐 devpath-ai）

| 类别 | 选型 | 版本 | 来源 |
|---|---|---|---|
| 框架 | Next.js (App Router) | ^15.3.9 | devpath-ai package.json |
| UI 库 | React + React DOM | ^19.1.0 | devpath-ai package.json |
| 样式 | Tailwind CSS + PostCSS + autoprefixer | ^3.4.4 | devpath-ai package.json |
| 本地存储 | Dexie (IndexedDB ORM) | ^4.4.4 | devpath-ai package.json |
| 本地 KV 缓存 | idb-keyval | ^6.2.1 | devpath-ai package.json |
| 部署适配 | @opennextjs/cloudflare（从 @cloudflare/next-on-pages 迁移） | latest | devpath-ai wrangler.toml |
| 运行时 | Cloudflare Workers (nodejs_compat) | compatibility_date 2024-12-30 | devpath-ai wrangler.toml |
| 云端存储 | Cloudflare KV（多 namespace） | - | devpath-ai wrangler.toml |
| 云端 AI | Cloudflare Workers AI（bge-base-en-v1.5 嵌入） | - | devpath-ai wrangler.toml `[ai]` binding |
| AI SDK | Vercel AI SDK + @ai-sdk/openai | ai ^3.4.0 | devpath-ai package.json |
| 多 provider | DeepSeek / GLM / OpenAI 兼容 | - | devpath-ai wrangler.toml `[vars] AI_PROVIDER` |
| 本地推理 | @xenova/transformers | ^2.17.2 | devpath-ai devDependencies |
| 间隔重复 | ts-fsrs | ^4.5.0 | devpath-ai package.json |
| Schema 校验 | Zod | ^3.23.8 | devpath-ai package.json |
| ID 生成 | nanoid | ^5.0.7 | devpath-ai package.json |
| 日期 | date-fns | ^4.4.0 | devpath-ai package.json |
| YAML 内容 | yaml | ^2.9.0 | devpath-ai package.json |
| 热力图 | react-activity-calendar | ^3.2.1 | devpath-ai package.json |
| 图表 | recharts | ^3.9.2 | devpath-ai package.json |
| 二维码 | qrcode | ^1.5.4 | devpath-ai package.json |
| 截图 | html-to-image | ^1.11.13 | devpath-ai package.json |
| 服务端标识 | server-only | ^0.0.1 | devpath-ai package.json |
| 类型 | TypeScript | ^5.5.0 | devpath-ai package.json |
| Lint | ESLint + eslint-config-next + @typescript-eslint | ^8.57.1 | devpath-ai package.json |
| 单测 | Vitest + @vitejs/plugin-react | ^1.6.0 | devpath-ai package.json |
| 组件测试 | @testing-library/react + jest-dom + fake-indexeddb | latest | devpath-ai package.json |
| E2E | Playwright | ^1.61.1 | devpath-ai package.json |
| DOM | jsdom | ^24.1.0 | devpath-ai package.json |
| Git Hooks | Husky + lint-staged | husky ^9.1.7 | devpath-ai package.json |
| 脚本运行 | tsx | ^4.23.1 | devpath-ai package.json |

**扩展项（需在 wrangler.toml 新增 binding，非 devpath-ai 既有）**：

| 扩展项 | 用途 | 必要性 |
|---|---|---|
| R2 bucket（`ATTACHMENTS`） | 大附件存储（图片/PDF/音频），零 egress | Phase 1 可选，Phase 2 必须 |
| 第二个 KV namespace（`NOTES_DELTA`） | 笔记内容密文中转（与元数据 KV 分离） | Phase 1 必须 |
| Cron Trigger | 每日凌晨触发夜间 Agent | Phase 3 必须 |

---

## 1. 架构总览

### 1.1 分层架构（沿用 devpath-ai 的 L1-L4 命名）

```
┌─────────────────────────────────────────────────────────────────┐
│  L4 交付层（用户直接感知）                                        │
│  编辑器 · 捕获入口 · 提议收件箱 · 语义检索 · FSRS 复习 · 数据导出 │
└───────────────────────────┬─────────────────────────────────────┘
                            │ React Server Components / Client Components
┌───────────────────────────▼─────────────────────────────────────┐
│  L3 智能层（AI 编排）                                            │
│  分层 AI（L1 浏览器 / L2 Workers AI / L3 BYOK 大模型 / L4 Cron）│
│  Agent 工具集 · 幂等键 · 多 provider 路由 · Zod schema 校验      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ AI SDK / fetch / getRequestContext().env
┌───────────────────────────▼─────────────────────────────────────┐
│  L2 数据层（local-first）                                        │
│  Dexie/IndexedDB（本地真理） · KV 加密备份 · R2 附件 · 向量索引   │
│  同步引擎（delta + 时间戳合并）· 版本快照                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  L1 基础设施层（Cloudflare）                                     │
│  Workers（nodejs_compat）· KV · R2 · Workers AI · Cron · Pages   │
│  零信任 session（MASTER_KEY + AUTH_SESSIONS/NONCES/AUDIT）       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 数据流（写作 → 同步 → AI 整理 → 检索）

```
用户写作
  │
  ▼
[Dexie 本地写入] ──(异步)──> [生成嵌入（本地 transformers.js 或 Workers AI）]
  │                                       │
  │ (联网时)                              │
  ▼                                       ▼
[KV 加密同步]                       [本地向量索引（idb-keyval）]
  │                                       │
  ▼                                       ▼
[多设备共享]                         [语义检索可用]

每日 03:00 UTC Cron Worker 触发：
  └─> 加载用户近 7 日笔记
       └─> L3 大模型分析（链接/合并/归档/触发）
            └─> 工具调用 create_proposal（幂等键去重）
                 └─> 提议写入 KV（pending 状态）
                      └─> 用户次日打开收件箱确认
                           └─> 接受 → apply_proposal 写入 Dexie + KV
                           └─> 忽略 → 标记 dismissed
```

### 1.3 卡帕西视角的设计取舍

| 决策 | 选择 | 理由（卡帕西式论证） |
|---|---|---|
| 数据真理 | 本地 Dexie，云端只备份 | 用户的思想不应默认在别人服务器上；本地即真理，云端是副本 |
| 同步协议 | 时间戳 + 字段级合并（非 CRDT） | devpath-ai 已验证此模式足够；CRDT（Yjs）引入额外依赖与复杂度，单人笔记场景过设计 |
| 向量索引存储 | 本地 idb-keyval（密文）+ KV 备份 | 单用户笔记 < 1 万条，384 维嵌入 < 10MB，本地完全可承载；避免引入 Vectorize 付费依赖 |
| 嵌入生成 | 双模式：本地 transformers.js + 云端 Workers AI | 隐私模式纯本地；成本模式走 Workers AI 免费额度；不依赖第三方向量服务 |
| 大模型调用 | BYOK 优先，Trial 兜底 | 用户数据不应成为平台变现资产；BYOK 让成本与控制权都归用户 |
| Schema 校验 | Zod 全链路 | AI 输出不可信，必须在边界处校验；devpath-ai 已验证此模式 |
| 内容工程 | YAML 源 + tsx 脚本 compile/validate | 模板与种子内容应版本化、可审计；与代码同质量门禁 |
| 模型即代码 | prompt 作为版本化配置 | prompt 是逻辑的一部分，应纳入 git 管理、可回滚、可 diff |
| 依赖最小化 | 不引入 Yjs/Automerge/Vectorize/Durable Objects | 每个依赖是未来负债；devpath-ai 已证明现有栈足够 |
| 测试 | Vitest + Playwright + fake-indexeddb | 本地优先应用必须在 fake IndexedDB 上可测；devpath-ai 已验证 |

---

## 2. 目录结构（基于 devpath-ai 调整）

```
mnemosyne/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (auth)/                   # 登录/设置路由组
│   │   │   ├── settings/page.tsx
│   │   │   └── onboarding/page.tsx
│   │   ├── (main)/                   # 主应用路由组
│   │   │   ├── page.tsx              # 今日（复习队列 + 提议收件箱）
│   │   │   ├── notes/
│   │   │   │   ├── page.tsx          # 笔记列表
│   │   │   │   └── [id]/page.tsx     # 编辑器
│   │   │   ├── map/page.tsx          # 知识地图
│   │   │   ├── recall/page.tsx       # 语义检索
│   │   │   └── review/page.tsx       # FSRS 复习
│   │   ├── api/                      # API Routes（Workers Functions）
│   │   │   ├── sync/route.ts         # 增量同步
│   │   │   ├── embed/route.ts        # 嵌入生成（Workers AI）
│   │   │   ├── chat/route.ts         # 流式问答（AI SDK）
│   │   │   ├── agent/cron/route.ts   # 夜间 Agent（Cron 触发）
│   │   │   ├── proposals/[id]/route.ts
│   │   │   ├── export/route.ts       # 数据导出
│   │   │   ├── import/route.ts       # 数据导入
│   │   │   └── auth/
│   │   │       ├── session/route.ts  # 零信任 session 建立
│   │   │       └── callback/route.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/                   # UI 组件
│   │   ├── editor/                   # markdown 编辑器
│   │   ├── proposals/                # 提议收件箱组件
│   │   ├── review/                   # FSRS 复习卡组件
│   │   ├── map/                      # 知识地图可视化
│   │   └── ui/                       # 基础组件（复用 devpath-ai）
│   ├── lib/                          # 核心逻辑
│   │   ├── db/                       # Dexie schema 与 DAO
│   │   │   ├── schema.ts             # 表定义
│   │   │   ├── notes.ts              # 笔记 DAO
│   │   │   ├── reviews.ts            # 复习卡 DAO
│   │   │   ├── proposals.ts          # 提议 DAO
│   │   │   └── snapshots.ts          # 版本快照 DAO
│   │   ├── sync/                     # 同步引擎
│   │   │   ├── engine.ts             # delta 计算 + 合并
│   │   │   ├── crypto.ts             # 端到端加密
│   │   │   └── kv-adapter.ts         # Cloudflare KV 适配
│   │   ├── ai/                       # AI 编排
│   │   │   ├── providers.ts          # 多 provider 路由
│   │   │   ├── embed.ts              # 嵌入生成（本地 + 云端）
│   │   │   ├── agent/                # 夜间 Agent
│   │   │   │   ├── tools.ts          # 工具定义（幂等键）
│   │   │   │   ├── runner.ts         # Agent 执行器
│   │   │   │   └── prompts/          # 版本化 prompt（YAML）
│   │   │   ├── chat.ts               # 流式问答
│   │   │   └── schemas.ts            # Zod schema（AI 输入输出）
│   │   ├── fsrs/                     # 间隔重复
│   │   │   ├── scheduler.ts          # ts-fsrs 封装
│   │   │   └── presets.ts            # 3 种预设
│   │   ├── auth/                     # 零信任 session
│   │   │   ├── session.ts            # session 建立/校验
│   │   │   ├── crypto.ts             # MASTER_KEY 加解密
│   │   │   └── audit.ts              # AUTH_AUDIT 写入
│   │   ├── markdown/                 # markdown 处理
│   │   │   ├── parser.ts             # 解析 + frontmatter
│   │   │   ├── bilink.ts             # 双链提取/插入
│   │   │   └── export.ts             # 导出 zip
│   │   └── utils/                    # 通用工具（复用 devpath-ai）
│   ├── content/                      # YAML 内容源
│   │   ├── seed-maps/                # 知识地图种子模板
│   │   └── prompts/                  # 版本化 prompt 源
│   ├── workers/                      # Worker 入口
│   │   └── open-next.config.ts       # OpenNext 适配
│   └── types/                        # TypeScript 类型
├── scripts/                          # 内容工程脚本（复用 devpath-ai 模式）
│   ├── compile-content.ts            # YAML → 编译产物
│   ├── validate-content.ts           # 内容校验
│   ├── audit-freshness.ts            # 内容新鲜度审计
│   ├── build-knowledge-index.ts      # 知识索引构建
│   └── export-presets.ts             # 预设导出
├── tests/
│   ├── unit/                         # Vitest 单测
│   ├── integration/                  # 集成测试（fake-indexeddb）
│   └── e2e/                          # Playwright E2E
├── docs/                             # 文档
│   ├── PRODUCT_DESIGN.md
│   └── TECHNICAL_DESIGN.md           # 本文档
├── .github/workflows/                # CI（复用 devpath-ai 4 层门禁）
├── .husky/                           # Git hooks
├── wrangler.toml                     # Cloudflare 配置
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── package.json
```

---

## 3. 数据模型（Dexie Schema）

### 3.1 表设计

```typescript
// src/lib/db/schema.ts
import Dexie, { Table } from 'dexie';

export interface Note {
  id: string;              // nanoid
  title: string;           // AI 生成或用户修改
  content: string;         // markdown 正文
  frontmatter: NoteFrontmatter;
  folderId: string | null;
  tags: string[];          // AI 自动 + 用户补充
  status: 'draft' | 'settled' | 'archived';
  source: 'manual' | 'clip' | 'voice' | 'bot' | 'email' | 'import';
  sourceMeta?: { url?: string; capturedAt?: number };
  createdAt: number;
  updatedAt: number;
  accessedAt: number;
  rev: number;             // 乐观锁版本号
  syncStatus: 'local' | 'synced' | 'pending';
  encryption: 'plain' | 'e2e';  // 敏感笔记可标记 e2e
}

export interface NoteFrontmatter {
  type?: 'note' | 'clip' | 'meeting' | 'idea' | 'reading';
  sourceUrl?: string;
  author?: string;
  [k: string]: unknown;
}

export interface Bilink {
  id: string;
  srcNoteId: string;
  dstNoteId: string;
  type: 'manual' | 'ai-proposed' | 'ai-accepted';
  reason?: string;         // AI 给出的关联理由
  confidence?: number;     // 0-1
  createdAt: number;
  createdBy: 'user' | 'agent';
}

export interface Proposal {
  id: string;              // 幂等键 = hash(noteId + action + targetHash)
  type: 'link' | 'merge' | 'archive' | 'trigger' | 'review-card' | 'map-update';
  status: 'pending' | 'accepted' | 'dismissed' | 'auto-applied';
  payload: ProposalPayload;  // 类型化负载
  reason: string;          // AI 推理链（可解释性）
  confidence: number;
  createdAt: number;
  decidedAt?: number;
  agentRunId: string;      // 关联到哪次 Agent 运行
}

export interface ReviewCard {
  id: string;
  noteId: string;
  front: string;           // 问题
  back: string;            // 答案
  fsrsState: ts-fsrs.Card; // ts-fsrs 状态对象
  preset: 'conservative' | 'standard' | 'aggressive';
  createdAt: number;
  lastReviewAt?: number;
  nextReviewAt: number;
  lapses: number;
}

export interface Snapshot {
  id: string;
  noteId: string;
  content: string;
  createdAt: number;
  reason: 'auto' | 'manual' | 'pre-agent-apply';
}

export interface AgentRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  trigger: 'cron' | 'manual';
  notesProcessed: number;
  proposalsCreated: number;
  tokensUsed: { input: number; output: number };
  cost: number;
  status: 'running' | 'success' | 'failed';
  error?: string;
}

export interface EmbeddingRecord {
  noteId: string;
  model: 'bge-base-en-v1.5' | 'local-mini';
  vector: number[];        // 384 或 768 维
  contentHash: string;     // 笔记内容哈希，用于判断是否需重新嵌入
  generatedAt: number;
  mode: 'local' | 'cloud';
}

class MnemosyneDB extends Dexie {
  notes!: Table<Note, string>;
  bilinks!: Table<Bilink, string>;
  proposals!: Table<Proposal, string>;
  reviewCards!: Table<ReviewCard, string>;
  snapshots!: Table<Snapshot, string>;
  agentRuns!: Table<AgentRun, string>;
  embeddings!: Table<EmbeddingRecord, string>;

  constructor() {
    super('mnemosyne');
    this.version(1).stores({
      notes: 'id, title, folderId, status, source, createdAt, updatedAt, accessedAt, syncStatus, *tags',
      bilinks: 'id, srcNoteId, dstNoteId, type, createdAt',
      proposals: 'id, type, status, createdAt, agentRunId',
      reviewCards: 'id, noteId, preset, nextReviewAt, lastReviewAt',
      snapshots: 'id, noteId, createdAt',
      agentRuns: 'id, startedAt, trigger, status',
      embeddings: 'noteId, model, contentHash, generatedAt',
    });
  }
}

export const db = new MnemosyneDB();
```

### 3.2 KV 存储结构

复用 devpath-ai 的多 namespace 模式：

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "KV"                    # 主数据 namespace
id = "..."

[[kv_namespaces]]
binding = "AUTH_SESSIONS"         # session 加密（复用 devpath-ai）
id = "..."

[[kv_namespaces]]
binding = "AUTH_NONCES"           # 防重放（复用 devpath-ai）
id = "..."

[[kv_namespaces]]
binding = "AUTH_AUDIT"            # 审计日志（复用 devpath-ai）
id = "..."

[[kv_namespaces]]
binding = "NOTES_DELTA"           # 笔记内容密文中转（扩展项）
id = "..."
```

KV key 设计（全部密文，MASTER_KEY 加密）：

| Namespace | Key 格式 | Value | TTL |
|---|---|---|---|
| `KV` | `u:{userId}:meta:{noteId}` | 加密的笔记元数据 JSON | 永久 |
| `KV` | `u:{userId}:idx:notes` | 加密的笔记索引（id 列表 + rev） | 永久 |
| `KV` | `u:{userId}:idx:bilinks` | 加密的双链索引 | 永久 |
| `NOTES_DELTA` | `u:{userId}:delta:{noteId}:{rev}` | 加密的笔记内容 delta | 30 天 |
| `AUTH_SESSIONS` | `sess:{sessionId}` | 加密的 session（含用户 BYOK key） | 7 天 |
| `AUTH_NONCES` | `nonce:{nonce}` | 时间戳 | 5 分钟 |
| `AUTH_AUDIT` | `audit:{userId}:{ts}` | 审计事件 | 90 天 |

### 3.3 Zod Schema（AI 边界校验）

```typescript
// src/lib/ai/schemas.ts
import { z } from 'zod';

export const ProposalSchema = z.object({
  type: z.enum(['link', 'merge', 'archive', 'trigger', 'review-card', 'map-update']),
  payload: z.union([
    z.object({  // link
      srcNoteId: z.string(),
      dstNoteId: z.string(),
      confidence: z.number().min(0).max(1),
    }),
    z.object({  // merge
      noteIds: z.array(z.string()).min(2),
      newTitle: z.string(),
    }),
    z.object({  // archive
      noteId: z.string(),
      reason: z.string(),
    }),
    z.object({  // trigger
      noteId: z.string(),
      triggerDate: z.string(),  // ISO
      relatedNoteIds: z.array(z.string()),
    }),
    z.object({  // review-card
      noteId: z.string(),
      cards: z.array(z.object({ front: z.string(), back: z.string() })).min(1),
    }),
    z.object({  // map-update
      weekKey: z.string(),
      nodes: z.array(z.object({ id: z.string(), label: z.string() })),
      edges: z.array(z.object({ src: z.string(), dst: z.string(), weight: z.number() })),
    }),
  ]),
  reason: z.string().min(20),  // 必须给出理由
  confidence: z.number().min(0).max(1),
});

export const ChatResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({
    noteId: z.string(),
    quote: z.string(),
    relevance: z.number(),
  })).max(5),
});

export const EmbeddingResponseSchema = z.object({
  vector: z.array(z.number()),
  model: z.string(),
  dim: z.number(),
});
```

---

## 4. 同步引擎

### 4.1 同步策略

**单用户多设备**场景，无需 CRDT，采用**时间戳 + 字段级合并 + 乐观锁**：

- 本地每次写入递增 `rev`
- 同步时上传 `delta`（仅变化字段 + rev）
- 服务端按 `rev` 顺序应用，冲突时取 `updatedAt` 更新者
- 拉取时对比本地 rev，落后则拉取最新

### 4.2 加密同步流

```typescript
// src/lib/sync/engine.ts
export async function syncNote(note: Note, env: Env, session: Session) {
  // 1. 本地加密
  const cipher = await encryptWithSessionKey(note.content, session.key);
  
  // 2. 上传 delta 到 NOTES_DELTA
  const delta = {
    noteId: note.id,
    rev: note.rev,
    contentCipher: cipher,
    meta: encryptJSON({
      title: note.title,
      tags: note.tags,
      updatedAt: note.updatedAt,
    }, session.key),
  };
  
  await env.NOTES_DELTA.put(
    `u:${session.userId}:delta:${note.id}:${note.rev}`,
    JSON.stringify(delta),
    { expirationTtl: 30 * 24 * 3600 }  // 30 天
  );
  
  // 3. 更新 KV 主索引
  await env.KV.put(
    `u:${session.userId}:meta:${note.id}`,
    delta.meta,
    { metadata: { rev: note.rev, updatedAt: note.updatedAt } }
  );
  
  // 4. 本地标记 synced
  await db.notes.update(note.id, { syncStatus: 'synced' });
}

export async function pullDeltas(env: Env, session: Session, sinceRev: number) {
  // 列出 NOTES_DELTA 中 rev > sinceRev 的所有 key
  const list = await env.NOTES_DELTA.list({
    prefix: `u:${session.userId}:delta:`,
  });
  
  const deltas = [];
  for (const key of list.keys) {
    const [, , , noteId, revStr] = key.name.split(':');
    const rev = parseInt(revStr, 10);
    if (rev > sinceRev) {
      const value = await env.NOTES_DELTA.get(key.name, 'json');
      deltas.push({ noteId, rev, ...value });
    }
  }
  
  // 本地解密 + 合并
  for (const delta of deltas) {
    const local = await db.notes.get(delta.noteId);
    if (!local || local.rev < delta.rev) {
      const content = await decryptWithSessionKey(delta.contentCipher, session.key);
      const meta = decryptJSON(delta.meta, session.key);
      await db.notes.put({ ...local, ...meta, content, rev: delta.rev, syncStatus: 'synced' });
    }
  }
}
```

### 4.3 冲突处理

字段级合并规则：

| 字段 | 冲突策略 |
|---|---|
| `content` | 取 updatedAt 更新者，旧版本存入 `snapshots` |
| `title` | 取 updatedAt 更新者 |
| `tags` | 并集（不丢失标签） |
| `folderId` | 取 updatedAt 更新者 |
| `status` | 取 updatedAt 更新者 |
| `frontmatter` | 浅合并，UpdatedAt 优先 |

---

## 5. AI 架构

### 5.1 分层 AI 实现

```typescript
// src/lib/ai/providers.ts
import { createOpenAI } from '@ai-sdk/openai';
import { getServerContext } from '@/lib/auth/session';

export type Provider = 'deepseek' | 'glm' | 'openai' | 'workers-ai' | 'local';

export async function getProvider(task: TaskType): Promise<Provider> {
  const session = await getServerContext();
  const userPref = session.userPrefs?.modelRouting?.[task];
  
  // BYOK 优先
  if (session.byokKeys?.[userPref ?? 'default']) {
    return userPref ?? 'deepseek';
  }
  
  // Trial 模式按配额
  if (await checkTrialQuota(session.userId, task)) {
    return 'deepseek';  // 平台 Trial 默认 DeepSeek
  }
  
  // 兜底：Workers AI 或本地
  return task === 'embed' ? 'workers-ai' : 'local';
}

export function createModel(provider: Provider, apiKey: string) {
  switch (provider) {
    case 'deepseek':
      return createOpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' })('deepseek-chat');
    case 'glm':
      return createOpenAI({ apiKey, baseURL: 'https://open.bigmodel.cn/api/paas/v4' })('glm-4.6');
    case 'openai':
      return createOpenAI({ apiKey })('gpt-4o');
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

### 5.2 嵌入生成（双模式）

```typescript
// src/lib/ai/embed.ts
import { pipeline } from '@xenova/transformers';

let localEmbedder: any = null;

async function getLocalEmbedder() {
  if (!localEmbedder) {
    localEmbedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'  // 384 维，浏览器内可跑
    );
  }
  return localEmbedder;
}

export async function embed(
  text: string,
  mode: 'local' | 'cloud' = 'cloud'
): Promise<{ vector: number[]; model: string; dim: number }> {
  if (mode === 'local') {
    const embedder = await getLocalEmbedder();
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return { vector: Array.from(output.data), model: 'local-mini', dim: 384 };
  }
  
  // Cloudflare Workers AI
  const env = getRequestContext().env;
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [text] });
  return { vector: result.data[0], model: 'bge-base-en-v1.5', dim: 768 };
}

export async function embedNote(noteId: string) {
  const note = await db.notes.get(noteId);
  if (!note) return;
  
  const contentHash = await sha256(note.content);
  const existing = await db.embeddings.get(noteId);
  if (existing?.contentHash === contentHash) return;  // 未变化
  
  const mode = note.encryption === 'e2e' ? 'local' : 'cloud';
  const { vector, model, dim } = await embed(note.content, mode);
  
  await db.embeddings.put({
    noteId,
    model,
    vector,
    contentHash,
    generatedAt: Date.now(),
    mode,
  });
}
```

### 5.3 混合检索

```typescript
// src/lib/ai/search.ts
export async function hybridSearch(query: string, topK = 5) {
  // 1. 关键词检索（Dexie FTS 模拟）
  const keywords = tokenize(query);
  const keywordResults = await db.notes
    .filter(n => keywords.some(k => n.content.includes(k) || n.title.includes(k)))
    .limit(50)
    .toArray();
  
  // 2. 语义检索（本地向量余弦相似）
  const queryVec = (await embed(query, 'local')).vector;
  const allEmbeddings = await db.embeddings.toArray();
  const semanticResults = allEmbeddings
    .map(e => ({
      note: e.noteId,
      score: cosineSimilarity(queryVec, e.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
  
  // 3. 融合排序（RRF：Reciprocal Rank Fusion）
  const fused = rrfFusion(keywordResults.map(n => n.id), semanticResults.map(r => r.note));
  
  // 4. 返回 topK
  return fused.slice(0, topK);
}

function rrfFusion(listA: string[], listB: string[], k = 60): string[] {
  const scores = new Map<string, number>();
  listA.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i)));
  listB.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i)));
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}
```

### 5.4 夜间 Agent

```typescript
// src/lib/ai/agent/runner.ts
import { tool } from 'ai';
import { z } from 'zod';

export async function runAgent(userId: string, env: Env) {
  const runId = nanoid();
  const startedAt = Date.now();
  
  await db.agentRuns.put({
    id: runId, startedAt, trigger: 'cron',
    notesProcessed: 0, proposalsCreated: 0,
    tokensUsed: { input: 0, output: 0 }, cost: 0,
    status: 'running',
  });
  
  try {
    // 1. 加载近 7 日新增/修改笔记
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    const recentNotes = await db.notes
      .where('updatedAt').above(since)
      .and(n => n.status !== 'archived')
      .toArray();
    
    // 2. 加载历史笔记用于关联
    const allNotes = await db.notes.where('status').equals('settled').toArray();
    
    // 3. 构建 Agent 上下文
    const context = buildAgentContext(recentNotes, allNotes);
    
    // 4. 调用 L3 大模型（BYOK 优先）
    const session = await getServerContext(userId);
    const provider = await getProvider('agent');
    const model = createModel(provider, session.byokKeys[provider]);
    
    // 5. 工具集（带幂等键）
    const tools = defineAgentTools(runId, userId);
    
    // 6. 流式执行
    const result = await generateText({
      model,
      system: AGENT_SYSTEM_PROMPT,  // 从 YAML 加载，版本化
      prompt: context,
      tools,
      maxSteps: 20,
      experimental_telemetry: { isEnabled: true },
    });
    
    // 7. 记录运行结果
    await db.agentRuns.update(runId, {
      finishedAt: Date.now(),
      notesProcessed: recentNotes.length,
      proposalsCreated: countProposals(result.toolCalls),
      tokensUsed: result.usage,
      cost: estimateCost(result.usage, provider),
      status: 'success',
    });
    
  } catch (err) {
    await db.agentRuns.update(runId, {
      finishedAt: Date.now(),
      status: 'failed',
      error: (err as Error).message,
    });
    throw err;
  }
}

function defineAgentTools(runId: string, userId: string) {
  return {
    create_proposal: tool({
      description: '创建一条整理提议（链接/合并/归档/触发/复习卡/地图更新）',
      parameters: ProposalSchema,
      execute: async (args) => {
        // 幂等键去重
        const idKey = hashIdempotencyKey(args);
        const existing = await db.proposals.get(idKey);
        if (existing) return { skipped: true, reason: 'duplicate' };
        
        await db.proposals.put({
          id: idKey,
          ...args,
          status: 'pending',
          createdAt: Date.now(),
          agentRunId: runId,
        });
        
        return { created: true, proposalId: idKey };
      },
    }),
  };
}
```

### 5.5 Prompt 版本化（YAML 内容工程）

```yaml
# src/content/prompts/agent-v1.yaml
id: agent-v1
version: 1.0.0
task: nightly-agent
model_pref: deepseek
system: |
  你是 Mnemosyne 的知识库整理 Agent。你的任务是阅读用户近 7 日的笔记，
  发现与历史笔记的关联，生成整理提议。
  
  原则：
  1. 永不直接修改笔记，只生成提议
  2. 每条提议必须给出 ≥20 字的理由
  3. 置信度 < 0.6 的关联不提议
  4. 一次运行最多生成 10 条提议，避免打扰
  5. 优先提议高价值关联（核心概念关联 > 边缘提及）
tools:
  - create_proposal
max_steps: 20
temperature: 0.3
```

通过 `scripts/compile-content.ts` 编译为 TypeScript 常量，纳入 4 层质量门禁。

---

## 6. 部署架构

### 6.1 wrangler.toml（完整配置）

```toml
name = "mnemosyne"
main = ".open-next/worker.js"
compatibility_date = "2024-12-30"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = ".open-next/assets"
binding = "ASSETS"

# 主数据 KV
[[kv_namespaces]]
binding = "KV"
id = "prod-kv-id"
preview_id = "preview-kv-id"

# 笔记 delta KV（扩展项）
[[kv_namespaces]]
binding = "NOTES_DELTA"
id = "prod-notes-delta-id"
preview_id = "preview-notes-delta-id"

# 零信任 session（复用 devpath-ai 三件套）
[[kv_namespaces]]
binding = "AUTH_SESSIONS"
id = "prod-auth-sessions-id"

[[kv_namespaces]]
binding = "AUTH_NONCES"
id = "prod-auth-nonces-id"

[[kv_namespaces]]
binding = "AUTH_AUDIT"
id = "prod-auth-audit-id"

# R2 附件存储（扩展项）
[[r2_buckets]]
binding = "ATTACHMENTS"
bucket_name = "mnemosyne-attachments"

# Workers AI（复用 devpath-ai）
[ai]
binding = "AI"

# Cron Trigger（扩展项，Phase 3 启用）
[triggers]
crons = ["0 3 * * *"]  # 每日 03:00 UTC

[vars]
AI_PROVIDER = "deepseek"
APP_URL = "https://mnemosyne.pages.dev"

# 密钥通过 wrangler secret put 上传：
# - MASTER_KEY            : 32 字节 base64
# - DEEPSEEK_API_KEY      : 平台 Trial 用
# - GLM_API_KEY           : 平台 Trial 用
# - OPENAI_API_KEY        : 平台 Trial 用（可选）
```

### 6.2 免费层成本测算

基于 [Cloudflare 免费层限制](https://developers.cloudflare.com/workers/platform/limits/)：

| 资源 | 免费额度 | 单用户日消耗 | 单用户月消耗 | 可承载用户数 |
|---|---|---|---|---|
| Workers 请求 | 10 万/天 | ~200（同步+AI） | ~6000 | 16 用户/天 |
| Workers CPU | 10ms/请求 | 平均 2-5ms | - | 充足 |
| KV 读 | 10 万/天 | ~150 | ~4500 | 22 用户/天 |
| KV 写 | 1000/天 | ~50 | ~1500 | 20 用户/天 |
| Workers AI 嵌入 | 按次 | ~30 | ~900 | 取决于额度 |
| R2 存储 | 10GB | < 1MB | ~30MB | 300+ 用户 |

**结论**：免费层可承载约 **15-20 个活跃用户/账户**。超出后需 Pro 层（$5/月解锁 1000 万请求/月）。

**BYOK 模式**：用户自带 API Key 时，AI 调用成本由用户承担，平台只承担 KV/Workers 成本，可承载用户数提升至 100+。

### 6.3 部署流程

```bash
# 1. 安装依赖
npm install

# 2. 本地开发（需配置 .env.local）
npm run dev

# 3. 质量门禁（4 层，复用 devpath-ai）
npm run quality-gate
# = content:validate + content:freshness + lint + typecheck + test

# 4. 构建（OpenNext 适配 Cloudflare）
npm run build
npx opennextjs-cloudflare build

# 5. 部署
npx wrangler deploy

# 6. 配置密钥
npx wrangler secret put MASTER_KEY
npx wrangler secret put DEEPSEEK_API_KEY
```

---

## 7. 安全架构

### 7.1 零信任 session（复用 devpath-ai）

```
用户首次设置 BYOK Key
        │
        ▼
[浏览器生成 MASTER_KEY（用户持有，永不上云）]
        │
        ▼
[用 MASTER_KEY 加密 BYOK Key → 密文]
        │
        ▼
[密文存入 AUTH_SESSIONS KV，session_id 返回浏览器]
        │
        ▼
[每次 AI 调用：浏览器发 session_id + nonce]
        │
        ▼
[Worker 校验 nonce（AUTH_NONCES 防重放）]
        │
        ▼
[Worker 用 MASTER_KEY 解密 BYOK Key（MASTER_KEY 从浏览器透传或 session 内）]
        │
        ▼
[用 BYOK Key 调用 LLM，全程密文]
        │
        ▼
[审计事件写入 AUTH_AUDIT]
```

**关键设计**：
- MASTER_KEY 永远不落服务端持久化，仅存在于浏览器内存或用户本地
- BYOK Key 在服务端只能短暂解密用于调用 LLM，调用完即清除
- 所有 AI 调用记录写入 AUTH_AUDIT，用户可在设置中查看
- Nonce 防重放：每次请求带一次性 nonce，5 分钟过期

### 7.2 笔记内容加密

- 笔记内容在本地用 MASTER_KEY 加密后上传 KV
- 服务端只见密文，无法读取用户笔记
- 向量嵌入：敏感笔记（`encryption: 'e2e'`）强制本地嵌入（transformers.js），不上 Workers AI
- R2 附件同样加密存储

### 7.3 边界校验（Zod 全链路）

- 所有 API Route 入参用 Zod 校验
- 所有 AI 输出用 Zod 校验后才入库
- 所有 Agent 工具参数用 Zod 校验
- 不信任任何外部输入（用户输入、AI 输出、KV 读取）

---

## 8. 质量保障

### 8.1 4 层 pre-push 门禁（复用 devpath-ai）

```json
// package.json scripts
{
  "quality-gate": "npm run content:validate && npm run content:freshness && npm run lint && npm run typecheck && npm test"
}
```

```bash
# .husky/pre-push
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npm run quality-gate
```

4 层：
1. **content:validate**：YAML 内容编译 + schema 校验
2. **content:freshness**：内容新鲜度审计（prompt/模板是否过期）
3. **lint**：ESint 0 warning 策略
4. **typecheck**：tsc --noEmit
5. **test**：Vitest 全量单测

### 8.2 测试策略

| 层级 | 工具 | 覆盖目标 |
|---|---|---|
| 单元测试 | Vitest | 工具函数、Zod schema、FSRS 调度、加密解密 |
| 组件测试 | @testing-library/react + fake-indexeddb | UI 组件、Dexie DAO |
| 集成测试 | Vitest + jsdom | 同步引擎、Agent 工具执行 |
| E2E | Playwright | 关键流：写作→同步→AI 整理→检索→复习 |
| 性能基准 | Vitest benchmark | 编辑器渲染 < 50ms、同步 < 500ms |

```typescript
// tests/integration/sync.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/lib/db/schema';
import { syncNote, pullDeltas } from '@/lib/sync/engine';

describe('sync engine', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  
  it('应正确加密并上传 delta', async () => {
    const note = await db.notes.add({ /* ... */ });
    await syncNote(note, mockEnv, mockSession);
    // 验证 KV 收到密文
    expect(mockEnv.NOTES_DELTA.put).toHaveBeenCalled();
    const stored = mockEnv.NOTES_DELTA.put.mock.calls[0][1];
    expect(stored).not.toContain(note.content);  // 内容不应明文出现
  });
  
  it('应正确拉取并合并 delta', async () => {
    // 模拟另一设备的 delta
    // 验证本地合并后 rev 更新
  });
});
```

### 8.3 监控

- Workers Analytics：请求量、CPU 时间、错误率
- AUTH_AUDIT：AI 调用审计、session 异常
- Agent 运行日志：`db.agentRuns` 表记录每次运行
- 用户感知监控：同步耗时、AI 首 token 耗时（客户端上报）

---

## 9. 性能优化

### 9.1 编辑器性能

- **CodeMirror 6** 或 **Milkdown** 作为 markdown 编辑器内核（视 Phase 1 决策）
- 大笔记（> 50KB）分块渲染，虚拟滚动
- 输入防抖：500ms 后才触发嵌入生成与同步
- 本地嵌入缓存：相同 contentHash 不重复嵌入

### 9.2 同步性能

- 增量 delta：只传变化字段，单次同步 < 10KB
- 批量同步：联网时一次性上传多个 delta
- 后台同步：用 `navigator.serviceWorker` + Background Sync API
- 冲突解决在本地完成，减少往返

### 9.3 检索性能

- 本地向量索引：单用户 < 1 万条笔记，全量余弦相似 < 100ms
- 嵌入预热：新笔记创建时异步生成嵌入
- 索引压缩：向量量化（int8）减少 75% 存储

### 9.4 Workers CPU 优化

- 单次请求 CPU < 10ms（免费层限制）
- 加密解密用 Web Crypto API（原生快）
- AI 调用走 subrequest，不计 CPU
- 大文件处理分块，避免单次超限

---

## 10. 演进路径

### Phase 1（MVP）
- 仅本地 Dexie + KV 加密备份
- 无 AI（仅手动 markdown 编辑）
- 一键导出 zip
- 从 Obsidian 导入

### Phase 2（AI 接入）
- Workers AI 嵌入 + 本地 transformers.js
- 混合检索 + 自然语言问答
- AI 自动标签/标题

### Phase 3（Agent 化）
- Cron Trigger 启用
- 夜间 Agent + 提议收件箱
- FSRS 复习卡自动生成
- 多 provider 路由

### Phase 4（生态）
- MCP 接口（让外部 Agent 读知识库）
- 浏览器剪藏插件
- 自托管版本开源
- 内容工程：知识地图种子模板（YAML）

### 扩展基础设施（按需）
- **Durable Objects**：多设备实时协同（多人协作时引入）
- **Vectorize**：用户笔记超 1 万条时，本地索引性能下降，迁移到 Vectorize
- **D1**：若需复杂关系查询（如知识图谱 SQL），可引入作为索引层，但内容仍存 markdown
- **Queues**：Agent 任务排队，避免单次 Cron 超时

**卡帕西原则**：每个扩展项的引入必须有明确的性能瓶颈证据，而非"未来可能用到"。

---

## 11. 附录

### 11.1 关键依赖版本锁定

```json
{
  "dependencies": {
    "next": "^15.3.9",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "dexie": "^4.4.4",
    "idb-keyval": "^6.2.1",
    "ai": "^3.4.0",
    "@ai-sdk/openai": "^0.0.66",
    "ts-fsrs": "^4.5.0",
    "zod": "^3.23.8",
    "nanoid": "^5.0.7",
    "date-fns": "^4.4.0",
    "yaml": "^2.9.0",
    "react-activity-calendar": "^3.2.1",
    "recharts": "^3.9.2",
    "qrcode": "^1.5.4",
    "html-to-image": "^1.11.13",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@cloudflare/next-on-pages": "^1.13.16",
    "@opennextjs/cloudflare": "latest",
    "@xenova/transformers": "^2.17.2",
    "@playwright/test": "^1.61.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/dom": "^10.4.1",
    "fake-indexeddb": "^6.0.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0",
    "eslint": "^8.57.1",
    "eslint-config-next": "^15.3.9",
    "@typescript-eslint/eslint-plugin": "^8.64.0",
    "@typescript-eslint/parser": "^8.64.0",
    "tailwindcss": "^3.4.4",
    "postcss": "^8.4.39",
    "autoprefixer": "^10.4.19",
    "husky": "^9.1.7",
    "lint-staged": "^17.0.8",
    "tsx": "^4.23.1",
    "jsdom": "^24.1.0",
    "@vitejs/plugin-react": "^4.7.0"
  }
}
```

### 11.2 参考文献

- [devpath-ai 仓库](https://github.com/soulor8908/devpath-ai)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [ts-fsrs 文档](https://github.com/open-spaced-repetition/ts-fsrs)
- [Vercel AI SDK](https://sdk.vercel.ai/)
- [@xenova/transformers](https://huggingface.co/docs/transformers.js)
- [Karpathy LLM Wiki 构想](https://developer.cloud.tencent.cn/article/2699037)

### 11.3 与 devpath-ai 的差异点总结

| 维度 | devpath-ai | Mnemosyne | 差异原因 |
|---|---|---|---|
| 领域 | 开发者成长 OS | 云笔记 | 不同业务 |
| 本地数据表 | knowledge_nodes, plans, energy_logs | notes, bilinks, proposals, review_cards | 领域实体不同 |
| AI 任务 | 知识拆解、计划生成、能量预测 | 嵌入、检索、Agent 整理 | 不同 AI 工作流 |
| Cron | 无 | 每日夜间 Agent | 新增基础设施 |
| R2 | 无 | 附件存储 | 新增基础设施 |
| 内容工程 | 知识节点 YAML | 知识地图种子 + prompt YAML | 复用方法论 |
| 核心算法 | 能量回归（自研） | FSRS（已有）+ RRF 检索融合 | 不同算法重点 |
| 共享基础设施 | Next.js/Dexie/KV/Workers AI/AI SDK/Zod/Husky 4层门禁 | 完全相同 | 架构复用 |
