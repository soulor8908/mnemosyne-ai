// Markdown 处理：frontmatter 解析、双链提取
import type { NoteFrontmatter } from '@/types';

const BILINK_REGEX = /\[\[([^\]]+)\]\]/g;

// 解析 frontmatter（YAML 风格）
export function parseFrontmatter(content: string): { frontmatter: NoteFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const yamlStr = match[1];
  const body = match[2];
  const frontmatter = parseSimpleYaml(yamlStr);
  return { frontmatter, body };
}

// 简单 YAML 解析（不引入完整 yaml 库，处理常见 frontmatter）
function parseSimpleYaml(str: string): NoteFrontmatter {
  const result: NoteFrontmatter = {};
  const lines = str.split('\n');
  for (const line of lines) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    const trimmed = value.trim().replace(/^["']|["']$/g, '');
    if (key === 'type') result.type = trimmed as NoteFrontmatter['type'];
    else if (key === 'sourceUrl') result.sourceUrl = trimmed;
    else if (key === 'author') result.author = trimmed;
    else if (key === 'publishedAt') result.publishedAt = Number(trimmed) || undefined;
    else (result as Record<string, unknown>)[key] = trimmed;
  }
  return result;
}

// 生成 frontmatter
export function stringifyFrontmatter(fm: NoteFrontmatter, body: string): string {
  const hasKeys = Object.keys(fm).length > 0;
  if (!hasKeys) return body;
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

// 提取双链目标
export function extractBilinks(content: string): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  BILINK_REGEX.lastIndex = 0;
  while ((m = BILINK_REGEX.exec(content)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

// 插入双链（在文末添加相关思考区块）
export function appendBilinkSection(content: string, links: Array<{ title: string; noteId: string }>): string {
  if (links.length === 0) return content;
  const section = `\n\n## 相关思考\n\n${links.map((l) => `- [[${l.title}]]`).join('\n')}\n`;
  return content + section;
}

// markdown 转纯文本（用于嵌入）
export function markdownToPlainText(md: string): string {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, '') // 去 frontmatter
    .replace(/^#+\s+/gm, '') // 标题
    .replace(/\*\*(.+?)\*\*/g, '$1') // 粗体
    .replace(/\*(.+?)\*/g, '$1') // 斜体
    .replace(/`{1,3}(.+?)`{1,3}/g, '$1') // 代码
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // 双链
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // 图片
    .replace(/^\s*[-*+]\s+/gm, '') // 列表
    .replace(/^\s*>\s+/gm, '') // 引用
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
