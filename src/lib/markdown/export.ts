// 数据导出：打包为 zip（纯前端，用 Blob）
import { getDb } from '@/lib/db/schema';
import type { Note } from '@/types';
import { stringifyFrontmatter } from '@/lib/markdown';

export interface ExportData {
  notes: Array<Note & { _fileName: string }>;
  folders: Array<{ id: string; name: string; parentId: string | null }>;
  bilinks: Array<{ srcNoteId: string; dstNoteId: string; reason?: string }>;
  reviewCards: Array<{ noteId: string; front: string; back: string }>;
  exportedAt: number;
  version: string;
}

// 收集所有可导出数据
export async function collectExportData(): Promise<ExportData> {
  const db = getDb();
  const [notes, folders, bilinks, reviewCards] = await Promise.all([
    db.notes.toArray(),
    db.folders.toArray(),
    db.bilinks.toArray(),
    db.reviewCards.toArray(),
  ]);

  const safeNotes = notes.map((n) => ({ ...n, _fileName: sanitizeFileName(n.title) || n.id }));

  return {
    notes: safeNotes,
    folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
    bilinks: bilinks.map((b) => ({ srcNoteId: b.srcNoteId, dstNoteId: b.dstNoteId, reason: b.reason })),
    reviewCards: reviewCards.map((c) => ({ noteId: c.noteId, front: c.front, back: c.back })),
    exportedAt: Date.now(),
    version: '0.1.0',
  };
}

// 生成 markdown 文件内容
export function noteToMarkdown(note: Note): string {
  const body = note.content;
  const fm = {
    type: note.frontmatter.type,
    sourceUrl: note.frontmatter.sourceUrl,
    tags: note.tags.length > 0 ? note.tags.join(', ') : undefined,
    created: new Date(note.createdAt).toISOString(),
    updated: new Date(note.updatedAt).toISOString(),
    source: note.source,
    id: note.id,
  };
  return stringifyFrontmatter(fm, body);
}

// 生成 index.json（元数据）
export function generateIndexJson(data: ExportData): string {
  return JSON.stringify(
    {
      version: data.version,
      exportedAt: data.exportedAt,
      noteCount: data.notes.length,
      notes: data.notes.map((n) => ({
        id: n.id,
        title: n.title,
        fileName: n._fileName,
        tags: n.tags,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      bilinks: data.bilinks,
      reviewCards: data.reviewCards,
      folders: data.folders,
    },
    null,
    2
  );
}

// 简单的 zip 替代方案：用 Blob 数组（浏览器端再打包）
// 为了零依赖，我们生成一个 JSON 备份 + 多个 md 文件
export async function exportAsJson(): Promise<Blob> {
  const data = await collectExportData();
  const json = JSON.stringify(data, null, 2);
  return new Blob([json], { type: 'application/json' });
}

// 导出为 markdown 文件集合（单个大文件，用分隔符）
export async function exportAsMarkdownBundle(): Promise<Blob> {
  const data = await collectExportData();
  const parts: string[] = [`# Mnemosyne Export\n\n导出时间：${new Date(data.exportedAt).toISOString()}\n笔记数：${data.notes.length}\n\n---\n`];

  for (const note of data.notes) {
    parts.push(`\n<!-- NOTE: ${note.id} -->\n`);
    parts.push(noteToMarkdown(note));
    parts.push('\n---\n');
  }

  // 双链索引
  if (data.bilinks.length > 0) {
    parts.push('\n## Bilinks\n');
    for (const link of data.bilinks) {
      parts.push(`- ${link.srcNoteId} → ${link.dstNoteId}${link.reason ? ` (${link.reason})` : ''}`);
    }
  }

  return new Blob([parts.join('\n')], { type: 'text/markdown' });
}

// 从 Obsidian vault 导入（解析 markdown 文件列表）
export async function importFromMarkdownFiles(files: File[]): Promise<number> {
  const { createNote } = await import('@/lib/db/notes');
  let count = 0;

  for (const file of files) {
    const text = await file.text();
    const { parseFrontmatter } = await import('@/lib/markdown');

    const { frontmatter, body } = parseFrontmatter(text);
    const title = file.name.replace(/\.md$/, '');

    await createNote({
      title,
      content: body,
      tags: frontmatter.type ? [frontmatter.type] : [],
      source: 'import',
    });
    count++;
  }

  return count;
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80)
    .trim();
}
