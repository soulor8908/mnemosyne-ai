// 通用工具：ID 生成、哈希、时间戳、防抖
import { nanoid } from 'nanoid';

export function genId(prefix = ''): string {
  return prefix ? `${prefix}_${nanoid(21)}` : nanoid(21);
}

export function now(): number {
  return Date.now();
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

// FNV-1a 哈希（快，非加密用途）
export function fnv1aHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// SHA-256（Web Crypto API，浏览器与 Workers 都支持）
export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 幂等键：基于内容哈希去重
export async function idempotencyKey(parts: string[]): Promise<string> {
  return sha256(parts.join('|'));
}

// 简单文本截断
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

// 从 markdown 提取第一行作为标题候选
export function extractTitleFromMarkdown(content: string): string {
  const firstLine = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '无标题';
  // 去掉 markdown 标记符号
  return firstLine
    .replace(/^#+\s*/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*>\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .slice(0, 80);
}

// 简单 tokenizer（用于关键词检索）
export function tokenize(text: string): string[] {
  // 中文按字 + 英文按词混合
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 0);
  // 中文单字也作为 token（粗粒度）
  const cjkTokens: string[] = [];
  for (const tok of tokens) {
    if (/[\u4e00-\u9fff]/.test(tok)) {
      for (const ch of tok) cjkTokens.push(ch);
    }
  }
  return [...tokens, ...cjkTokens];
}

// 余弦相似度
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
