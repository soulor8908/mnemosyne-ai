// Mnemosyne MCP 服务器（stdio）
//
// 让任意兼容 MCP 的客户端（Claude Desktop、Cursor、等）把 mnemosyne-ai
// 当作「记忆后端」来用：剪藏网页、生成向量、基于笔记上下文问答、检索。
//
// 隐私边界：mnemosyne-ai 是 local-first + 端到端加密应用，云端只见密文。
// 因此 search_notes 默认只返回 queryVector（真实匹配在客户端进行）；
// 若设置 MNEMOSYNE_NOTES_EXPORT 指向你「自己导出的明文 JSON」，则额外在
// 本机导出的笔记上做关键词检索——数据不出本机，不解密任何云端内容。
//
// 运行：
//   MNEMOSYNE_TOKEN=<你的令牌> npx tsx src/mcp/server.ts
// 或
//   npm run mcp   （同样读取下方环境变量）
//
// 环境变量：
//   MNEMOSYNE_BASE_URL      部署地址，默认 http://localhost:3000
//   MNEMOSYNE_TOKEN         SYNC_TOKEN 或零信任会话令牌（Bearer）
//   MNEMOSYNE_NOTES_EXPORT  可选，本地导出 JSON 路径，启用本地检索

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MnemosyneClient } from './client';

const baseUrl = process.env.MNEMOSYNE_BASE_URL ?? 'http://localhost:3000';
const token = process.env.MNEMOSYNE_TOKEN ?? '';
const notesExportPath = process.env.MNEMOSYNE_NOTES_EXPORT;

if (!token) {
  console.error(
    '[mnemosyne-mcp] 未设置 MNEMOSYNE_TOKEN。请在环境变量中提供 SYNC_TOKEN 或零信任会话令牌。'
  );
  process.exit(1);
}

const client = new MnemosyneClient({ baseUrl, token, notesExportPath });

const server = new McpServer({ name: 'mnemosyne-ai', version: '0.1.0' });

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

server.tool(
  'mnemosyne_embed_text',
  '为一段文本生成向量（Workers AI bge-base-en-v1.5，768 维）。返回 { vector, model, dim }。',
  { text: z.string().min(1, '文本不能为空') },
  async ({ text }) => {
    const result = await client.embedText(text);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'mnemosyne_ask',
  '基于笔记上下文向 Mnemosyne 知识库助手提问。助手只会依据 context 中的笔记作答，' +
    '逐条用 [n] 标注出处；无相关笔记时诚实拒答。context 为空则直接拒答。',
  {
    question: z.string().min(1, '问题不能为空'),
    context: z.string().optional().describe('笔记摘录文本；为空时助手会拒答'),
  },
  async ({ question, context }) => {
    const result = await client.ask(question, context);
    return { content: [{ type: 'text', text: result.answer }] };
  }
);

server.tool(
  'mnemosyne_search_notes',
  '检索笔记。返回 queryVector（真实匹配在客户端进行，因端到端加密）。' +
    '若配置了 MNEMOSYNE_NOTES_EXPORT，额外在导出的明文笔记上做本机关键词检索并返回 localMatches。',
  {
    query: z.string().min(1, '查询不能为空'),
    topK: z.number().int().min(1).max(20).optional().describe('本地检索返回条数，默认 5'),
  },
  async ({ query, topK }) => {
    const result = await client.searchNotes(query, topK ?? 5);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mnemosyne-mcp] stdio 服务器已启动，连接至 ' + baseUrl);
}

main().catch((err) => {
  console.error('[mnemosyne-mcp] 启动失败：', err);
  process.exit(1);
});
