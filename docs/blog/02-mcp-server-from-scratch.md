# 从 0 到 1 写一个标准 MCP Server：让 Claude 读你的知识库

> MCP（Model Context Protocol）是 Anthropic 2024 年底推出的开放协议，被称为"AI 应用的 USB-C 接口"。我给 [Mnemosyne](https://github.com/soulor8908/mnemosyne-ai)（local-first 云笔记）写了一个标准 MCP Server，现在 Claude Desktop / Cursor 可以直接检索我的笔记、剪藏网页、生成向量。
>
> 这篇文章讲清楚 MCP Server 到底怎么写、有哪些坑、以及一个 local-first + 端到端加密的应用怎么在"服务端看不到明文"的前提下还能让外部 Agent 检索——这个矛盾点本身就是面试加分项。

## 一、MCP 是什么，为什么值得学

一句话：**MCP 让任意 AI 客户端（Claude Desktop / Cursor / Cline）能以标准方式调用你的应用暴露的工具**。

在 MCP 之前，想让 Claude 读你的知识库，要么手动复制粘贴，要么写个定制插件——每个客户端一套协议。MCP 之后，写一个 MCP Server，所有兼容 MCP 的客户端都能用。

**对求职的意义**：2026 年 JD 里"熟悉 MCP 协议"已经是高频加分项。会写标准 MCP Server 是稀缺技能——因为协议新，大部分人还停留在"听过"阶段。

## 二、MCP Server 的心智模型

MCP 是 JSON-RPC 2.0 over stdio（或 HTTP）。一个 MCP Server 本质上做三件事：

1. **声明工具**：告诉客户端"我有哪些工具，每个工具的参数 schema 是什么"
2. **响应调用**：客户端决定调用某工具时，执行业务逻辑，返回结果
3. **通过 stdio 通信**：标准输入读请求，标准输出写响应——不占端口，不走 HTTP

最关键的是：**工具的参数 schema 用 Zod 定义，SDK 自动转成 JSON Schema 暴露给客户端**。客户端的 LLM 看到这些 schema，就知道该传什么参数。

## 三、我的 4 个工具

我的笔记应用暴露了 4 个工具：

| 工具 | 作用 | 返回 |
|---|---|---|
| `mnemosyne_capture_webpage` | 抓取 URL 正文 | `{ title, content, url, capturedAt }` |
| `mnemosyne_embed_text` | 生成文本向量 | `{ vector, model, dim }` |
| `mnemosyne_ask` | 基于笔记上下文问答 | `{ answer }` |
| `mnemosyne_search_notes` | 检索笔记 | `{ queryVector, localMatches?, note }` |

为什么是这 4 个？因为它们覆盖了"AI 用笔记"的完整链路：**抓取 → 向量化 → 检索 → 问答**。少了任何一环，Agent 都没法完成"读一篇网页，跟我已有笔记做关联"这种任务。

## 四、Server 主入口：25 行启动一个 MCP Server

```typescript
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MnemosyneClient } from './client';

const baseUrl = process.env.MNEMOSYNE_BASE_URL ?? 'http://localhost:3000';
const token = process.env.MNEMOSYNE_TOKEN ?? '';

if (!token) {
  console.error('[mnemosyne-mcp] 未设置 MNEMOSYNE_TOKEN');
  process.exit(1);
}

const client = new MnemosyneClient({ baseUrl, token, notesExportPath });
const server = new McpServer({ name: 'mnemosyne-ai', version: '0.1.0' });

// ... 注册 4 个工具 ...

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mnemosyne-mcp] stdio 服务器已启动');
}
main().catch((err) => { console.error(err); process.exit(1); });
```

几个要点：

1. **`StdioServerTransport`**：用 stdio 而非 HTTP，因为 Claude Desktop 通过子进程拉起 MCP Server，stdin/stdout 是天然通信通道
2. **启动校验**：token 必须有，没有就 `process.exit(1)`——fail-closed
3. **`console.error` 而非 `console.log`**：stdout 是协议通道，日志必须走 stderr，否则会污染 JSON-RPC 流

## 五、注册一个工具：Zod schema 是核心

```typescript
server.tool(
  'mnemosyne_capture_webpage',
  '剪藏一个公开网页：服务端抓取 URL 并提取正文，返回 { title, content, url, capturedAt }。' +
    '抓取的明文不会自动入库（笔记仍存于用户浏览器），但可直接交给模型阅读/摘要。',
  { url: z.string().url('必须是合法的 http(s) 链接') },
  async ({ url }) => {
    const result = await client.captureWebpage(url);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);
```

`server.tool()` 四个参数：

1. **工具名**：客户端调用时的标识
2. **描述**：LLM 看这段话决定什么时候用这个工具——**写清楚比写花哨重要**
3. **参数 schema**：Zod 对象，SDK 自动转 JSON Schema 给客户端
4. **处理函数**：接收经 Zod 校验的参数，返回 `{ content: [{ type: 'text', text }] }`

**描述为什么重要？** LLM 是基于描述决定调用的。我最初写成"剪藏网页"，LLM 在用户问"帮我读一下这篇文章"时不知道该不该调。改成"剪藏一个公开网页：服务端抓取 URL 并提取正文"后，调用准确率明显提升。**MCP 工具描述是 prompt engineering 的一部分**。

## 六、返回格式的坑：必须是 content 数组

工具返回值必须是这个形状：

```typescript
return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
```

我一开始直接 `return { content: [{ type: 'text', text: result }] }`，result 是个对象——结果客户端收到 `[object Object]`。**text 字段必须是 string**，对象要先 `JSON.stringify`。

这个坑不大，但说明 MCP 的返回格式是严格的——它不是任意 JSON 通道，而是结构化消息协议。

## 七、最难的设计：端到端加密 vs 外部检索

这是本文最值得讲的部分。

### 7.1 矛盾

Mnemosyne 是 local-first + 端到端加密：笔记明文只在用户浏览器，云端 KV 只存密文，**服务端无法解密**。

但 MCP Server 是个服务端进程，外部 Agent（Claude Desktop）通过它要检索笔记——**服务端拿不到明文，怎么做检索？**

这是架构层面的矛盾：零信任承诺 vs 外部可检索性。

### 7.2 我的方案：分层降级

我让 `search_notes` 工具有三种行为，按数据可达性降级：

```typescript
// src/mcp/client.ts
async searchNotes(query: string, topK = 5): Promise<SearchNotesResult> {
  let queryVector: number[] = [];
  let model = 'unavailable';
  let remoteError: string | undefined;

  // 层 1：远程只返回 queryVector（真实匹配在客户端做）
  try {
    const remote = await this.search(query);
    queryVector = remote.queryVector;
    model = remote.model;
  } catch (err) {
    remoteError = err instanceof Error ? err.message : String(err);
  }

  // 层 2：若配置了本地导出文件，额外在明文上做关键词检索
  let localMatches: LocalMatch[] | undefined;
  if (this.notesExportPath) {
    const notes = await this.readExport(this.notesExportPath);
    localMatches = searchExport(notes, query, topK);
  }

  return {
    queryVector, model, localMatches, remoteError,
    note: '真实笔记匹配在客户端进行（端到端加密，服务端只见密文）。' +
          '若配置了本地导出文件，则额外在导出的明文笔记上做关键词检索（数据不出本机）。',
  };
}
```

**层 1**：服务端能调 `/api/embed` 生成 query 向量，但**不能解密笔记**，所以只返回向量。真正的向量匹配在客户端浏览器里做（客户端有 masterKey 能解密）。

**层 2**：如果用户配置了 `MNEMOSYNE_NOTES_EXPORT` 指向一个本地导出的明文 JSON，MCP Server 在本机读这个文件做关键词检索。**数据不出本机，不解密任何云端内容**——隐私无损。

**层 3**：远程向量失败（离线、Workers AI 挂了）也不影响本地检索——`remoteError` 记原因，`localMatches` 照常返回。

### 7.3 为什么这样设计是对的

- **零信任承诺不破**：服务端从不解密笔记，外部 Agent 也拿不到明文
- **可检索性最大化**：在隐私允许的范围内，尽可能让 Agent 有信息可用
- **降级而非失败**：单点故障（远程 embed 挂了）不让整个工具废掉

这个设计本身就是面试题级别的——"端到端加密的应用怎么让外部 Agent 检索？"我能在白板上画出这三层。

## 八、纯逻辑客户端：可测试性的关键

我没有把 HTTP 调用直接写死在工具处理函数里，而是抽出一个 `MnemosyneClient` 类，**关键在于它纯逻辑、无 Next/Cloudflare 依赖**：

```typescript
type FetchImpl = (input: string | URL, init?: {...}) => Promise<{...}>;

export interface MnemosyneClientOptions {
  baseUrl: string;
  token: string;
  notesExportPath?: string;
  fetchImpl?: FetchImpl;        // 注入 fetch（测试用）
  readExport?: (path: string) => Promise<ExportNote[]>;  // 注入文件读取（测试用）
}
```

两个注入点：`fetchImpl` 和 `readExport`。测试时注入桩函数，不依赖真实网络和文件系统。

```typescript
constructor(opts: MnemosyneClientOptions) {
  this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  this.token = opts.token;
  this.notesExportPath = opts.notesExportPath;
  this.fetchImpl = opts.fetchImpl ?? ((globalThis as any).fetch as FetchImpl);
  this.readExport = opts.readExport ?? readExportFile;
}
```

**为什么要这样？** 因为 MCP Server 跑在 Node 进程里，而我的应用是 Next.js + Cloudflare Workers。如果 Client 直接 import `next/server` 或 `@opennextjs/cloudflare`，在 Node 测试环境里根本跑不起来。**纯逻辑 + 依赖注入是跨运行时复用代码的唯一方式**。

我的 15 个 MCP 客户端测试就是这么写的——注入假 fetch 和假文件读取，断言行为，不碰真实网络：

```typescript
// tests/mcp-client.test.ts
const fakeNotes = [{ id: 'n1', title: 'RAG 架构', content: '向量检索...' }];
const client = new MnemosyneClient({
  baseUrl: 'http://fake',
  token: 't',
  notesExportPath: '/fake/path',
  fetchImpl: fakeFetch,
  readExport: async () => fakeNotes,
});
const result = await client.searchNotes('RAG', 5);
expect(result.localMatches?.[0].id).toBe('n1');
```

## 九、本地检索算法：关键词加权 + 片段抽取

层 2 的本地检索是个纯函数，值得单独讲：

```typescript
export function searchExport(notes: ExportNote[], query: string, topK = 5): LocalMatch[] {
  const terms = extractTerms(query);
  if (terms.length === 0) return [];

  const scored = notes.map((n) => {
    const titleL = n.title.toLowerCase();
    const contentL = n.content.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (titleL.includes(t)) score += 5;  // 标题命中权重高
      if (contentL.includes(t)) score += 1; // 正文命中权重低
    }
    return { n, score };
  })
  .filter((x) => x.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, topK);

  return scored.map(({ n, score }) => ({
    id: n.id, title: n.title, score, url: n.url,
    snippet: makeSnippet(n.content, terms),  // 抽取命中片段
  }));
}
```

两个设计点：

1. **标题权重 5，正文权重 1**——标题命中的笔记更可能是目标
2. **makeSnippet 抽取命中片段**——返回给 LLM 时，给上下文窗口省 token，而不是把整篇笔记塞进去

```typescript
function makeSnippet(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;  // 取最早命中位置
  }
  if (idx < 0) return content.slice(0, 160);
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + 100);
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
}
```

**给 LLM 的上下文要省 token**——这是工程现实，不是抠门。

## 十、解析 Vercel AI SDK 的 data stream

`mnemosyne_ask` 工具调 `/api/chat`，这个端点用 Vercel AI SDK 返回的是 data stream（`0:"..."\n0:"..."\n` 格式），不是普通 JSON。我得自己解析：

```typescript
export function parseChatDataStream(text: string): string {
  let out = '';
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('0:')) continue;
    const json = t.slice(2).trim();
    try {
      out += JSON.parse(json) as string;  // 每行是一个 JSON 字符串增量
    } catch {
      /* 跳过损坏片段 */
    }
  }
  return out;
}
```

Vercel AI SDK 的流协议是：每行 `<index>:<json-encoded-chunk>`，`0:` 表示文本增量。**这个格式没在文档首页写清楚**，我是抓包看出来的。解析时 `JSON.parse` 是因为 chunk 是 JSON 编码的字符串（带引号转义），不是裸文本。

**坑**：如果 MCP Server 要对接任何流式 LLM 端点，都得自己处理流协议。SDK 不帮你。

## 十一、Claude Desktop 配置

Server 写完后，在 Claude Desktop 的 `claude_desktop_config.json` 里注册：

```json
{
  "mcpServers": {
    "mnemosyne": {
      "command": "npx",
      "args": ["tsx", "/path/to/src/mcp/server.ts"],
      "env": {
        "MNEMOSYNE_BASE_URL": "https://your-app.workers.dev",
        "MNEMOSYNE_TOKEN": "<你的会话令牌>",
        "MNEMOSYNE_NOTES_EXPORT": "/path/to/notes-export.json"
      }
    }
  }
}
```

重启 Claude Desktop，对话框里会出现 🔌 图标表示工具已加载。然后你可以问：

> "帮我搜一下我笔记里关于 RAG 的内容"

Claude 会自动调 `mnemosyne_search_notes`，拿到 localMatches，然后基于这些片段回答。

## 十二、踩过的坑总结

| 坑 | 原因 | 修复 |
|---|---|---|
| `console.log` 导致协议解析失败 | stdout 是 JSON-RPC 通道，日志不能走 stdout | 全改 `console.error` |
| 工具返回 `[object Object]` | `text` 字段必须是 string，对象没 stringify | `JSON.stringify(result, null, 2)` |
| LLM 不调用工具 | 工具描述太简略，LLM 不知道何时用 | 描述写清楚输入输出和适用场景 |
| 测试跑不起来 | Client 依赖 Next/CF 运行时 | 抽成纯逻辑 + 注入 fetch |
| 流式问答返回乱码 | Vercel AI SDK 的 data stream 格式 | 自己写 `parseChatDataStream` |
| 服务端没法检索笔记 | 端到端加密，服务端无明文 | 三层降级：queryVector / 本地导出 / 离线 |

## 十三、MCP Server 的设计原则（我的总结）

1. **工具描述是 prompt engineering**——写清楚输入输出和适用场景，LLM 才知道何时调
2. **stdout 是协议通道，日志走 stderr**——这是 stdio transport 的铁律
3. **返回值严格按 schema**——`content: [{ type: 'text', text: string }]`，不能裸对象
4. **纯逻辑客户端 + 依赖注入**——跨运行时复用 + 可测试
5. **降级而非失败**——单点故障不让整个工具废掉
6. **隐私边界要显式**——零信任应用里，哪些数据能出本机、哪些不能，要在工具描述里写清楚

## 十四、MCP 的未来

MCP 还很新，但趋势明显：

- **Anthropic 在推**，Claude Desktop / Cursor / Cline 已支持
- **OpenAI 也在跟进**，2026 年大概率会有更多客户端兼容
- **协议本身在演进**：现在主要是 stdio，HTTP+SSE transport 也在规划

会写 MCP Server 在 2026 年是稀缺技能，但不会一直稀缺。**现在做出来，简历就能写"有 MCP Server 开发经验"——这是时间窗口红利**。

---

**项目地址**：[github.com/soulor8908/mnemosyne-ai](https://github.com/soulor8908/mnemosyne-ai)
**相关代码**：
- [src/mcp/server.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/mcp/server.ts) — MCP Server 主入口
- [src/mcp/client.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/mcp/client.ts) — 纯逻辑客户端
- [tests/mcp-client.test.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/tests/mcp-client.test.ts) — 15 个测试用例

**上一篇**：[《local-first + 零信任多用户登录的云笔记架构》](./01-local-first-zerotrust-architecture.md)
**下一篇预告**：《混合检索的坑：维度不匹配 bug 复盘》
