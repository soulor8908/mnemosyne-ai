// Inbox 文件解析器：飞书捕获通道的接缝契约
// Trae 捕获 Agent 产出 .md 文件 → 本解析器消费 → 转为 Note 输入
// 详见 docs/superpowers/specs/2026-07-29-feishu-share-capture-design.md §4
import { parse as parseYaml } from 'yaml';
import type { NoteFrontmatter, NoteSource } from '@/types';

// inbox frontmatter 的状态：inbox 待消费 / inbox-raw AI总结失败 / ingested 已入库
export type InboxStatus = 'inbox' | 'inbox-raw' | 'ingested';

export interface InboxFrontmatter {
  id: string;
  source: 'feishu-share';
  sourceUrl: string;
  feishuChatId?: string;
  feishuMessageId?: string;
  capturedAt: string; // ISO 字符串
  title: string;
  author?: string;
  publishedAt?: string; // ISO 字符串
  tags: string[];
  summary?: string;
  knowledgePoints?: string[];
  status: InboxStatus;
}

export interface ParsedInboxFile {
  frontmatter: InboxFrontmatter;
  body: string;
  raw: string;
}

// 转换为 createNote 所需的输入
export interface IngestibleNoteInput {
  id: string;
  title: string;
  content: string;
  frontmatter: NoteFrontmatter;
  tags: string[];
  source: Extract<NoteSource, 'feishu'>;
  sourceMeta: {
    url: string;
    capturedAt: number;
    feishuChatId?: string;
    feishuMessageId?: string;
  };
}

// 解析 inbox markdown 文件。格式不符（无 frontmatter / 缺必需字段）返回 null。
export function parseInboxFile(content: string): ParsedInboxFile | null {
  // 支持 LF / CRLF
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;

  const yamlStr = match[1];
  const body = match[2];

  let fm: Record<string, unknown>;
  try {
    fm = parseYaml(yamlStr) ?? {};
  } catch {
    return null;
  }

  if (!fm || typeof fm !== 'object') return null;

  // 校验必需字段
  const required: Array<keyof InboxFrontmatter> = [
    'id', 'source', 'sourceUrl', 'capturedAt', 'title', 'status',
  ];
  for (const key of required) {
    if (fm[key] === undefined || fm[key] === null || fm[key] === '') return null;
  }

  const frontmatter: InboxFrontmatter = {
    id: String(fm.id),
    source: fm.source as 'feishu-share',
    sourceUrl: String(fm.sourceUrl),
    feishuChatId: fm.feishuChatId ? String(fm.feishuChatId) : undefined,
    feishuMessageId: fm.feishuMessageId ? String(fm.feishuMessageId) : undefined,
    capturedAt: String(fm.capturedAt),
    title: String(fm.title),
    author: fm.author ? String(fm.author) : undefined,
    publishedAt: fm.publishedAt ? String(fm.publishedAt) : undefined,
    tags: toStringArray(fm.tags),
    summary: fm.summary ? String(fm.summary) : undefined,
    knowledgePoints: fm.knowledgePoints ? toStringArray(fm.knowledgePoints) : undefined,
    status: fm.status as InboxStatus,
  };

  return { frontmatter, body, raw: content };
}

// 只有 status=inbox 的文件才该被 Mnemosyne 消费入库
export function isIngestible(parsed: ParsedInboxFile): boolean {
  return parsed.frontmatter.status === 'inbox';
}

// 把解析后的 inbox 文件转换为 createNote 输入
export function toNoteInput(parsed: ParsedInboxFile): IngestibleNoteInput {
  const fm = parsed.frontmatter;
  const frontmatter: NoteFrontmatter = {
    type: 'reading',
    sourceUrl: fm.sourceUrl,
    author: fm.author,
    publishedAt: fm.publishedAt ? Date.parse(fm.publishedAt) : undefined,
    summary: fm.summary,
    knowledgePoints: fm.knowledgePoints,
  };

  return {
    id: fm.id,
    title: fm.title,
    content: parsed.body,
    frontmatter,
    tags: fm.tags,
    source: 'feishu',
    sourceMeta: {
      url: fm.sourceUrl,
      capturedAt: Date.parse(fm.capturedAt),
      feishuChatId: fm.feishuChatId,
      feishuMessageId: fm.feishuMessageId,
    },
  };
}

// 把 YAML 值统一为 string[]
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') {
    return v.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}
