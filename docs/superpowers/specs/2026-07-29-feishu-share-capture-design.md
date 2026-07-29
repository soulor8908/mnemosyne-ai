# 飞书分享捕获 → Mnemosyne 知识库 · 设计文档

> 把"看到好文章 → 分享到飞书 → 第二天打开 Mnemosyne → 结构化知识点已就位"变成一条无需人工整理的自动化链路。
>
> 本设计是 Mnemosyne 已规划但未落地的「无感捕获」模块的一个具体捕获通道（飞书通道）。
>
> 配套文档：[产品设计文档](../../PRODUCT_DESIGN.md) · [技术设计文档](../../TECHNICAL_DESIGN.md)

---

## 1. 背景与目标

### 1.1 用户场景

用户平时在各处（浏览器、微信、RSS）看到好文章，希望以最低 friction 把它变成自己知识库里的结构化知识点：

1. 在看到文章的地方用系统分享 / 转发，把 **URL 链接** 发到飞书的一个固定会话（自己和机器人的私聊，或一个专门的"收藏群"）
2. 当晚 23:00，Trae 定时任务自动：读飞书会话 → 抓正文 → AI 总结成知识点
3. 第二天打开 Mnemosyne，结构化笔记已自动入库，并交给现有夜间 Agent 做跨笔记链接 / 复习卡

### 1.2 目标

- **零整理**：用户只负责"分享 URL"，分类、标题、标签、知识点提取全部由 AI 事后补全
- **本地优先 + 零信任不破坏**：明文只在用户本地出现，服务端永不见明文
- **复用现有架构**：不造新表、不引入新基础设施，复用 Mnemosyne 的 Note schema / 同步 / 嵌入 / 夜间 Agent
- **复用 Trae 的 Lark MCP**：不注册飞书应用、不做飞书 OAuth，用 Trae 已有的 lark-im MCP 读消息

### 1.3 非目标（显式划掉，避免范围蔓延）

- ❌ 不做实时入库（已确认走夜间批量）
- ❌ Mnemosyne 侧不调飞书 API / 不做飞书 OAuth（用 Lark MCP 代替）
- ❌ 不做"原子知识卡片"颗粒度（每篇 = 一条笔记，含原文 + 知识点，不做一篇文章拆多张卡）
- ❌ 不做跨产品协作 / 多人共享

---

## 2. 方案选型

经过对比三个方案，选定 **方案 1：Trae 自动化 → markdown 文件 → Mnemosyne 导入**。

| 方案 | 接缝 | 用 Lark MCP | 零信任 | 出活速度 | 选否 |
|---|---|---|---|---|---|
| **1. Trae → md 文件 → 导入** | markdown 文件 | ✅ | ✅（明文仅本地） | 快 | ✅ 选定 |
| 2. Mnemosyne 内建飞书捕获 | 浏览器调飞书 API | ❌ | ✅ | 慢 | ❌ |
| 3. Trae → API → 捕获队列 | KV 队列 + 鉴权端点 | ✅ | ✅ | 中 | ❌（演进备选） |

**选定理由**：
- markdown 是 Mnemosyne 的原生数据格式（呼应"数据即文件"原则），接缝耦合最低、可 diff、可审计
- 直接用 Trae 已有的 Lark MCP，零新增鉴权
- 几乎不写 Mnemosyne 新代码——只是把路线图里已规划的"从 Obsidian vault 导入"提前做并指向 inbox
- 演进路径清晰：若"导入那一下"觉得碍事，可平滑升级到方案 3 的捕获队列

---

## 3. 架构总览

整条链路是**两个半边 + 一个文件接缝**：

```
┌─────────────── 半边 A：Trae 捕获大脑（夜间）────────────────┐
│  Trae Schedule (cron 0 23 * * *)                              │
│    ├─ lark-im MCP 读飞书指定会话的未处理 URL 消息              │
│    ├─ WebFetch 抓正文 → 转 markdown（去广告，保留来源元数据）  │
│    ├─ AI 总结：{一句话总结, 3-7 知识点, 3-5 标签}（Zod 校验）  │
│    └─ 组装 markdown 写到本地 inbox/ 文件夹                     │
└──────────────────────────┬──────────────────────────────────┘
                           │  接缝 = markdown + frontmatter 文件
                           │  （Mnemosyne 原生格式，明文仅本地）
┌──────────────────────────▼──────────────────────────────────┐
│  半边 B：Mnemosyne 金库（启动时/手动触发）                    │
│    ├─ 扫描 inbox/ → 解析 frontmatter                          │
│    ├─ sourceUrl 去重 → MASTER_KEY 加密 → 本地建笔记           │
│    ├─ 生成嵌入 → 同步 KV（密文）                               │
│    ├─ 导入后文件移到 inbox/archive/（可审计可重放）            │
│    └─ 笔记 status=draft，交给现有夜间 Agent 做链接/复习卡      │
└──────────────────────────────────────────────────────────────┘
```

### 三个设计原则

1. **明文边界最小**：明文只出现在 `inbox 文件夹 → 浏览器内存 → MASTER_KEY 加密` 这条链上，服务端永不见明文（零信任不破坏）
2. **markdown 即接缝**：两系统唯一耦合是 `.md` 文件格式，可 diff、可审计、可手动编辑 / 重放
3. **不造新表**：复用 Mnemosyne 现有 `Note` schema（`source: 'feishu'`、`sourceMeta.url`），半边 B 不加新数据表

---

## 4. 接缝契约 — inbox markdown 格式

两系统唯一的耦合点。同时是 Trae 的产物和 Mnemosyne 的输入，必须精确。

### 4.1 文件格式

```yaml
---
id: <nanoid>                  # Trae 生成，幂等键 + 文件名一部分
source: feishu-share
sourceUrl: https://example.com/article
feishuChatId: oc_xxx          # 回溯用
feishuMessageId: om_xxx       # 回溯用
capturedAt: 2026-07-29T23:05:00Z
title: <AI 生成标题>
author: <原文作者，抓不到为空字符串>
publishedAt: <原文发布时间 ISO，抓不到为空字符串>
tags: [AI, 知识管理]            # 3-5 个
summary: <一句话总结>
knowledgePoints:              # 3-7 个
  - 核心知识点 1
  - 核心知识点 2
status: inbox                 # inbox | ingested | inbox-raw
---

## 原文
<抓取的正文 markdown>

## 知识点
- 核心知识点 1
- 核心知识点 2
```

### 4.2 文件命名与归档

- 文件名：`{YYYY-MM-DD}_{id}.md`，按日期可排序
- 消费后：Mnemosyne 把 `status` 改 `ingested`，文件移到 `inbox/archive/{date}/`，**不删除**（可重放、可审计）
- 去重跳过的：移到 `inbox/archive/{date}/_skipped/`

### 4.3 status 取值

| status | 含义 | 产生方 |
|---|---|---|
| `inbox` | 已抓取+AI总结完成，待 Mnemosyne 消费 | Trae |
| `inbox-raw` | AI 总结失败，仅有原文，待人工或重试 | Trae |
| `ingested` | 已被 Mnemosyne 消费入库 | Mnemosyne |

---

## 5. 半边 A：Trae 捕获 Agent

### 5.1 触发

Trae Schedule，cron `0 23 * * *`（每晚 23:00，用户本地时区）。

### 5.2 配置

`~/.mnemosyne-capture/config.json`：

```json
{
  "feishuChatId": "oc_xxx",
  "inboxPath": "~/mnemosyne-inbox",
  "manifestPath": "~/.mnemosyne-capture/manifest.json",
  "lookbackHours": 48,
  "maxRetries": 3,
  "aiProvider": "default"
}
```

| 字段 | 说明 | 默认 |
|---|---|---|
| `feishuChatId` | 要读的飞书会话（私聊 or 收藏群） | 必填 |
| `inboxPath` | markdown 落盘目录 | `~/mnemosyne-inbox` |
| `manifestPath` | 去重清单路径 | `~/.mnemosyne-capture/manifest.json` |
| `lookbackHours` | 读飞书消息回看窗口 | 48 |
| `maxRetries` | 失败 URL 重试上限 | 3 |
| `aiProvider` | 总结用的 provider | default（走 Trae 的 AI） |

### 5.3 执行步骤

1. **读飞书**：lark-im MCP 列出 `feishuChatId` 近 `lookbackHours` 的消息
2. **提 URL**：正则提取消息中的 `https?://` 链接；非 URL 消息跳过
3. **去重**：查 manifest.processedUrls + failedUrls，跳过已处理
4. **抓正文**：WebFetch 每个 URL → 提取 title / author / publishedTime + 正文 markdown（去广告）
5. **AI 总结**：对正文调 AI，结构化输出 `{title, summary, knowledgePoints[3-7], tags[3-5]}`，Zod schema 校验
6. **写文件**：组装 frontmatter + 正文 + 知识点，写到 `{inboxPath}/{date}_{id}.md`
7. **更新 manifest**：processedUrls 追加、lastRunAt / lastMessageId 更新

### 5.4 manifest.json 结构

```json
{
  "processedUrls": ["https://...", "https://..."],
  "failedUrls": [
    {"url": "https://...", "reason": "403", "retries": 2}
  ],
  "lastRunAt": "2026-07-29T23:05:00Z",
  "lastMessageId": "om_xxx"
}
```

### 5.5 AI 输出 Zod schema

```typescript
const ArticleSummarySchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(10).max(200),
  knowledgePoints: z.array(z.string().min(1)).min(3).max(7),
  tags: z.array(z.string().min(1)).min(3).max(5),
});
```

---

## 6. 半边 B：Mnemosyne inbox 导入器

### 6.1 入口

- 设置 → 数据导入 → 新增「扫描 inbox 文件夹」按钮（手动触发）
- 启动时自动扫描（设置开关，默认开）

### 6.2 目录访问

| 环境 | 方式 |
|---|---|
| 桌面端 Chrome/Edge | File System Access API，首次授权一个目录（持久化授权，下次免点） |
| 不支持 FS API | 拖拽 .md 文件到导入区 |
| 兜底 | 文件选择器手动上传 |

### 6.3 单文件 ingest 流程

1. 读文件 → 解析 frontmatter（复用现有 markdown parser）
2. **status 过滤**：只消费 `status: inbox` 的文件
   - `status: inbox-raw`（AI 总结失败）→ **跳过且不移动**，留在 inbox/ 原地等 Trae 下次重试覆盖
   - `status: ingested` → 已处理过，跳过移 `_skipped/`
3. **去重**：查 `notes` 表 `sourceMeta.url === frontmatter.sourceUrl`
   - 已存在 → 跳过，文件移 `archive/{date}/_skipped/`
4. 构建 `Note` 对象：
   - `id`：保留 `frontmatter.id`（跨系统回溯）
   - `title`：`frontmatter.title`
   - `content`：文件正文体（`## 原文` + `## 知识点`）
   - `frontmatter`：`{ type:'reading', sourceUrl, author, publishedAt, summary, knowledgePoints }`
   - `tags`：`frontmatter.tags`
   - `source: 'feishu'`（现有 source union 加一个枚举值）
   - `sourceMeta: { url, capturedAt, feishuChatId, feishuMessageId }`
   - `status: 'draft'`
   - `encryption: 'plain'`（默认；用户可后续手动标 e2e）
5. MASTER_KEY 加密 → 写 Dexie → 同步 KV（复用 `syncNote`）
6. 生成嵌入（复用 `embedNote`）
7. 文件移 `inbox/archive/{date}/`，frontmatter `status` 改 `ingested`

### 6.4 schema 改动

仅一处小改 [src/lib/db/schema.ts](../../../src/lib/db/schema.ts)：

```typescript
// Note.source 增加 'feishu'
source: 'manual' | 'clip' | 'voice' | 'bot' | 'email' | 'import' | 'feishu';
```

不加新表、不加新字段（`sourceMeta` 已是现有字段，只是填入 feishu 相关键）。

---

## 7. 去重与并发

### 7.1 去重（双保险）

| 层 | 机制 |
|---|---|
| Trae 侧 | manifest.processedUrls，已抓过的 URL 不重复抓 |
| Mnemosyne 侧 | `notes.sourceMeta.url` 唯一性检查，已入库的不重复导入 |

### 7.2 幂等

导入中断后重跑安全：
- 已入库的笔记：文件已移走 + DB 去重双保险
- 未入库的文件：仍在 inbox/，重跑会处理

### 7.3 并发

客户端串行处理 inbox 文件，无并发问题。

---

## 8. 错误处理

边界处必须诚实，失败也要留下可追溯的痕迹。

### 8.1 Trae 侧

| 失败场景 | 处理 |
|---|---|
| 正文抓取失败（403 / paywall / 超时） | **仍写一条笔记**：content 标注"抓取失败，仅有 URL"，保留 sourceUrl 供手动补；failedUrls 记录，重试 ≤ maxRetries 次后放弃 |
| AI 总结失败 | 原文保留，summary / knowledgePoints 留空，`status: inbox-raw`，待人工或下次重试 |
| 飞书 MCP 读消息失败 | 整次运行失败，manifest.lastRunAt 不更新，下次重跑 |

### 8.2 Mnemosyne 侧

| 失败场景 | 处理 |
|---|---|
| frontmatter 解析失败 | 文件移 `archive/_invalid/`，记日志，不阻断其他文件 |
| sourceUrl 重复 | 跳过，移 `_skipped/` |
| 加密 / 同步失败 | 笔记不写入，文件留在 inbox/ 原地，下次重试 |

---

## 9. 与现有夜间 Agent 衔接

- 导入的笔记 `status='draft'`，**自动进入现有夜间 Agent 的处理范围**（Agent 已设计处理近 7 日新增 / 修改笔记）
- 现有 Agent 已能做：链接提议（语义关联到已有笔记）、提炼提议（合并同主题碎片为沉淀笔记）、复习卡生成、知识地图
- 飞书捕获的笔记 = 普通笔记，**不特殊对待**——外来知识自动融入已有体系，这正是 Mnemosyne 的核心价值
- **可选增强**（后续 Phase，非本期必须）：Agent 对 `source='feishu'` 的笔记优先做"提炼提议"，因为外来内容更需要被融入而非孤立存在

---

## 10. 测试策略

| 层级 | 工具 | 覆盖 |
|---|---|---|
| Trae 侧单测 | 纯函数 | manifest 去重、URL 提取正则、AI 输出 Zod 校验、frontmatter 组装 |
| Mnemosyne 侧单测 | Vitest + fake-indexeddb（复用现有栈） | inbox 解析、sourceUrl 去重、Note 构造、加密入库 |
| 契约测试 | Vitest | 一个固定 .md 样例，Trae 产出 + Mnemosyne 消费双向跑，确保格式一致 |
| E2E | Playwright | 放 .md 到 inbox → 触发导入 → 笔记出现在列表 |

---

## 11. 配置项汇总

### 11.1 Trae 侧

见 §5.2，`~/.mnemosyne-capture/config.json`。

### 11.2 Mnemosyne 侧

设置页新增：

| 设置项 | 类型 | 默认 |
|---|---|---|
| 启动时自动扫描 inbox | 开关 | 开 |
| inbox 文件夹路径（FS API 授权句柄） | 目录授权 | 未授权 |
| 手动「立即扫描 inbox」 | 按钮 | - |

---

## 12. 演进路径

| 阶段 | 内容 |
|---|---|
| **本期（方案 1）** | Trae 定时任务 + markdown inbox + Mnemosyne 文件夹导入 |
| 演进 A | 若"导入那一下"觉得碍事 → 升级为方案 3：Trae 推 API → Mnemosyne KV 捕获队列 → 客户端拉取自动入库 |
| 演进 B | 若需实时 → 加飞书事件订阅（lark-event）webhook，分享即入库 |
| 演进 C | 多捕获通道复用同一 inbox 契约：微信/TG Bot、邮件转发、浏览器剪藏，都产出同一格式的 .md，Mnemosyne 统一消费 |

演进 A/B/C 都是增量，不重写本期。

---

## 13. 与 Mnemosyne 现有设计的关系

| 现有设计项 | 本期关系 |
|---|---|
| 产品设计 §4.1.1 无感捕获 — "微信/TG Bot 转发即入库" | 本期是同一捕获模块的**飞书通道**实现 |
| 产品设计 §4.1.3 沉默的 AI 助手（夜间 Agent） | 本期捕获的笔记**直接复用**该 Agent 做后续整理 |
| 技术设计 §3.1 Note schema | 仅给 `source` 加 `'feishu'` 枚举值，无其他改动 |
| 技术设计 §4 同步引擎 | 复用 `syncNote`，无改动 |
| 技术设计 §5.2 嵌入生成 | 复用 `embedNote`，无改动 |
| 技术设计 §7.1 零信任 session | 不破坏——明文只在客户端，服务端永不见 |
| 路线图 Phase 1「从 Obsidian vault 导入」 | 本期的 inbox 导入器是该功能的**特化先行版**（扫指定文件夹而非全 vault） |
