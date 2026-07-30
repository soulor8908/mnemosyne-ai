// Mnemosyne MCP 客户端（纯逻辑，无 Next / Cloudflare 依赖，可在 Node / 测试中断言）
//
// 设计边界（重要）：mnemosyne-ai 是 local-first + 端到端加密应用。
// 笔记明文只存在于用户浏览器（IndexedDB），云端 KV 只存密文，服务端无法解密。
// 因此本客户端只能包装「服务端可达」的端点：
//   - /api/capture  剪藏网页（服务端抓取 + 提取正文，返回明文）
//   - /api/embed    生成文本向量（Workers AI）
//   - /api/chat     基于调用方提供的 context 做「有出处、可拒答」的问答
//   - /api/search   返回 queryVector（真实笔记匹配在客户端进行）
// 另提供 searchNotes：在用户「自己导出的明文 JSON」上做本地关键词检索，
// 这是隐私无损的——导出文件在用户本机，不上传、不解密云端数据。

import { readFile } from 'node:fs/promises';

/** 极简 fetch 签名，兼容全局 fetch 与测试桩 */
type FetchImpl = (
  input: string | URL,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}>;

export interface MnemosyneClientOptions {
  baseUrl: string;
  /** SYNC_TOKEN（遗留共享令牌）或零信任会话令牌（Bearer 携带） */
  token: string;
  /** 本地导出文件（ExportData JSON）路径，用于 searchNotes 的本地检索 */
  notesExportPath?: string;
  /** 注入 fetch（测试用），默认全局 fetch */
  fetchImpl?: FetchImpl;
  /** 注入导出文件读取（测试用），默认 node:fs readFile */
  readExport?: (path: string) => Promise<ExportNote[]>;
}

export interface CaptureResult {
  title: string;
  content: string;
  url: string;
  capturedAt: number;
}

export interface EmbedResult {
  vector: number[];
  model: string;
  dim: number;
}

export interface AskResult {
  answer: string;
}

export interface SearchResult {
  queryVector: number[];
  model: string;
}

export interface ExportNote {
  id: string;
  title: string;
  content: string;
  url?: string;
}

export interface LocalMatch {
  id: string;
  title: string;
  snippet: string;
  score: number;
  url?: string;
}

export interface SearchNotesResult {
  queryVector: number[];
  model: string;
  /** 仅当配置了本地导出文件时返回 */
  localMatches?: LocalMatch[];
  note: string;
}

export class MnemosyneClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly notesExportPath?: string;
  private readonly fetchImpl: FetchImpl;
  private readonly readExport: (path: string) => Promise<ExportNote[]>;

  constructor(opts: MnemosyneClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.notesExportPath = opts.notesExportPath;
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as any).fetch as FetchImpl);
    this.readExport = opts.readExport ?? readExportFile;
  }

  private async request<T = any>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = `请求失败 (${res.status})`;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* 非 JSON 错误体 */
      }
      throw new Error(msg);
    }
    return JSON.parse(text) as T;
  }

  /** 剪藏网页：服务端抓取 URL 并提取正文 */
  async captureWebpage(url: string): Promise<CaptureResult> {
    if (!/^https?:\/\//i.test(url.trim())) {
      throw new Error('请提供合法的 http(s) 链接');
    }
    return this.request<CaptureResult>('/api/capture', { url: url.trim() });
  }

  /** 生成文本向量（Workers AI，bge-base-en-v1.5，768 维） */
  async embedText(text: string): Promise<EmbedResult> {
    if (!text.trim()) throw new Error('文本不能为空');
    return this.request<EmbedResult>('/api/embed', { text });
  }

  /**
   * 基于笔记上下文的问答。
   * context 为调用方提供的笔记摘录（[n] 编号由调用方约定）；
   * 无 context 时服务端会诚实拒答，绝不编造。
   */
  async ask(question: string, context?: string): Promise<AskResult> {
    if (!question.trim()) throw new Error('问题不能为空');
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: question }],
        context,
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      let msg = `问答失败 (${res.status})`;
      try {
        const j = JSON.parse(raw) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    // /api/chat 返回 Vercel AI SDK data stream；解析 0:"..." 文本增量
    return { answer: parseChatDataStream(raw) };
  }

  /** 返回 queryVector（真实笔记匹配在客户端进行，因 E2E 加密） */
  async search(query: string): Promise<SearchResult> {
    if (!query.trim()) throw new Error('查询不能为空');
    return this.request<SearchResult>('/api/search', { query });
  }

  /**
   * 综合检索：远程返回 queryVector（供客户端语义匹配），
   * 若配置了本地导出文件，额外在导出的明文笔记上做关键词检索。
   */
  async searchNotes(query: string, topK = 5): Promise<SearchNotesResult> {
    const { queryVector, model } = await this.search(query);
    let localMatches: LocalMatch[] | undefined;
    if (this.notesExportPath) {
      const notes = await this.readExport(this.notesExportPath);
      localMatches = searchExport(notes, query, topK);
    }
    return {
      queryVector,
      model,
      localMatches,
      note:
        '真实笔记匹配在客户端进行（端到端加密，服务端只见密文）。remote 仅返回 queryVector；' +
        '若配置了本地导出文件，则额外在导出的明文笔记上做关键词检索（数据不出本机）。',
    };
  }
}

// ============ 本地导出检索（纯函数，可独立测试） ============

/** 从 ExportData JSON 读取笔记（兼容数组或 { notes: [...] } 两种形状） */
export async function readExportFile(path: string): Promise<ExportNote[]> {
  const raw = await readFile(path, 'utf-8');
  const data = JSON.parse(raw) as any;
  const notes = Array.isArray(data) ? data : data?.notes ?? [];
  return (notes as any[]).map((n) => ({
    id: String(n.id ?? ''),
    title: String(n.title ?? ''),
    content: String(n.content ?? ''),
    url: n.sourceMeta?.url ?? n.url,
  }));
}

/** 抽取检索词：英文/数字词整体保留，连续 CJK 作为一个词 */
export function extractTerms(query: string): string[] {
  const parts = query.toLowerCase().match(/[a-z0-9]+|[一-龥]+/gi) ?? [];
  return parts.map((p) => p.toLowerCase()).filter((p) => p.length > 0);
}

/** 在导出的明文笔记上做关键词加权检索，返回 topK */
export function searchExport(notes: ExportNote[], query: string, topK = 5): LocalMatch[] {
  const terms = extractTerms(query);
  if (terms.length === 0) return [];

  const scored = notes
    .map((n) => {
      const titleL = n.title.toLowerCase();
      const contentL = n.content.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (titleL.includes(t)) score += 5;
        if (contentL.includes(t)) score += 1;
      }
      return { n, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(({ n, score }) => ({
    id: n.id,
    title: n.title,
    score,
    url: n.url,
    snippet: makeSnippet(n.content, terms),
  }));
}

function makeSnippet(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return content.slice(0, 160);
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, idx + 100);
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
}

/** 解析 Vercel AI SDK data stream：累加 0:"..." 文本增量 */
export function parseChatDataStream(text: string): string {
  let out = '';
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('0:')) continue;
    const json = t.slice(2).trim();
    try {
      out += JSON.parse(json) as string;
    } catch {
      /* 跳过损坏片段 */
    }
  }
  return out;
}
