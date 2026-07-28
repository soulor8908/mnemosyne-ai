// 数据导出/导入：支持 JSON 备份、Markdown、HTML，可按笔记选择导出
import { getDb } from '@/lib/db/schema';
import type { Note, NoteFrontmatter } from '@/types';
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
  return buildExportData(notes, folders, bilinks, reviewCards);
}

// 按笔记 ID 列表收集导出数据（包含相关 bilinks/reviewCards）
export async function collectExportDataByIds(noteIds: string[]): Promise<ExportData> {
  if (noteIds.length === 0) return buildExportData([], [], [], []);
  const db = getDb();
  const idSet = new Set(noteIds);
  const [notes, folders, bilinks, reviewCards] = await Promise.all([
    db.notes.where('id').anyOf(noteIds).toArray(),
    db.folders.toArray(),
    db.bilinks.where('srcNoteId').anyOf(noteIds).toArray(),
    db.reviewCards.where('noteId').anyOf(noteIds).toArray(),
  ]);
  // 仅保留两端都在选中集合内的双链
  const filteredBilinks = bilinks.filter(
    (b) => idSet.has(b.srcNoteId) && idSet.has(b.dstNoteId)
  );
  return buildExportData(notes, folders, filteredBilinks, reviewCards);
}

function buildExportData(
  notes: Note[],
  folders: { id: string; name: string; parentId: string | null }[],
  bilinks: { srcNoteId: string; dstNoteId: string; reason?: string }[],
  reviewCards: { noteId: string; front: string; back: string }[]
): ExportData {
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
  const fm: NoteFrontmatter & Record<string, unknown> = {
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

// 全量 JSON 备份
export async function exportAsJson(): Promise<Blob> {
  const data = await collectExportData();
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

// 按选择的笔记 ID 导出 JSON
export async function exportSelectedAsJson(noteIds: string[]): Promise<Blob> {
  const data = await collectExportDataByIds(noteIds);
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

// 全量 Markdown bundle（单文件，注释分隔）
export async function exportAsMarkdownBundle(): Promise<Blob> {
  const data = await collectExportData();
  return new Blob([buildMarkdownBundle(data)], { type: 'text/markdown' });
}

// 按选择的笔记 ID 导出 Markdown bundle
export async function exportSelectedAsMarkdown(noteIds: string[]): Promise<Blob> {
  const data = await collectExportDataByIds(noteIds);
  return new Blob([buildMarkdownBundle(data)], { type: 'text/markdown' });
}

function buildMarkdownBundle(data: ExportData): string {
  const parts: string[] = [
    `# Mnemosyne Export\n\n导出时间：${new Date(data.exportedAt).toISOString()}\n笔记数：${data.notes.length}\n\n---\n`,
  ];
  for (const note of data.notes) {
    parts.push(`\n<!-- NOTE: ${note.id} -->\n`);
    parts.push(noteToMarkdown(note));
    parts.push('\n---\n');
  }
  if (data.bilinks.length > 0) {
    parts.push('\n## Bilinks\n');
    for (const link of data.bilinks) {
      parts.push(`- ${link.srcNoteId} → ${link.dstNoteId}${link.reason ? ` (${link.reason})` : ''}`);
    }
  }
  return parts.join('\n');
}

// ============ 导入 ============

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// 从 Markdown 文件列表导入（支持 Obsidian / Typora / 通用 .md）
export async function importFromMarkdownFiles(files: File[]): Promise<ImportResult> {
  const { createNote } = await import('@/lib/db/notes');
  const { parseFrontmatter } = await import('@/lib/markdown');
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  for (const file of files) {
    try {
      const text = await file.text();
      const { frontmatter, body } = parseFrontmatter(text);
      const title =
        (frontmatter as any).title as string | undefined ||
        file.name.replace(/\.(md|markdown|txt)$/i, '');

      // 解析 tags（支持逗号分隔或数组）
      const tagsRaw = (frontmatter as any).tags;
      let tags: string[] = [];
      if (Array.isArray(tagsRaw)) tags = tagsRaw.map(String);
      else if (typeof tagsRaw === 'string' && tagsRaw.trim()) {
        tags = tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
      }

      await createNote({
        title,
        content: body,
        tags,
        source: 'import',
        sourceMeta: frontmatter.sourceUrl ? { url: frontmatter.sourceUrl } : undefined,
      });
      result.imported++;
    } catch (err) {
      result.errors.push(`${file.name}: ${(err as Error).message}`);
      result.skipped++;
    }
  }
  return result;
}

// 从 Mnemosyne JSON 备份导入（恢复 notes + folders + bilinks + reviewCards）
export async function importFromJson(file: File): Promise<ImportResult> {
  const db = getDb();
  const { genId, now, extractTitleFromMarkdown } = await import('@/lib/utils');
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  let data: ExportData;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    result.errors.push('JSON 解析失败：' + (err as Error).message);
    return result;
  }

  if (!data.notes || !Array.isArray(data.notes)) {
    result.errors.push('文件格式不正确：缺少 notes 字段');
    return result;
  }

  // 笔记 ID 映射（旧 ID → 新 ID），用于重建 bilinks
  const idMap = new Map<string, string>();

  await db.transaction('rw', db.notes, db.folders, db.bilinks, db.reviewCards, async () => {
    // 文件夹
    if (data.folders) {
      for (const f of data.folders) {
        await db.folders.put({
          id: f.id || genId('folder'),
          name: f.name,
          parentId: f.parentId,
          createdAt: now(),
          updatedAt: now(),
        });
      }
    }

    // 笔记
    for (const n of data.notes) {
      const newId = genId('note');
      idMap.set(n.id, newId);
      const ts = now();
      const note: Note = {
        id: newId,
        title: n.title || extractTitleFromMarkdown(n.content) || '无标题',
        content: n.content || '',
        frontmatter: n.frontmatter || {},
        folderId: n.folderId ?? null,
        tags: n.tags ?? [],
        status: n.status ?? 'draft',
        source: 'import',
        sourceMeta: n.sourceMeta,
        createdAt: n.createdAt ?? ts,
        updatedAt: ts,
        accessedAt: ts,
        rev: 1,
        syncStatus: 'local',
        encryption: 'plain',
      };
      await db.notes.add(note);
      result.imported++;
    }

    // 双链（映射新 ID）
    if (data.bilinks) {
      for (const b of data.bilinks) {
        const src = idMap.get(b.srcNoteId);
        const dst = idMap.get(b.dstNoteId);
        if (!src || !dst) {
          result.skipped++;
          continue;
        }
        await db.bilinks.add({
          id: genId('link'),
          srcNoteId: src,
          dstNoteId: dst,
          type: 'ai-accepted',
          reason: b.reason,
          confidence: 1,
          createdBy: 'agent',
          createdAt: now(),
        });
      }
    }

    // 复习卡
    if (data.reviewCards) {
      for (const c of data.reviewCards) {
        const noteId = idMap.get(c.noteId);
        if (!noteId) {
          result.skipped++;
          continue;
        }
        await db.reviewCards.add({
          id: genId('card'),
          noteId,
          front: c.front,
          back: c.back,
          preset: 'standard',
          fsrsState: {
            due: now() + 86400000,
            stability: 0,
            difficulty: 0,
            elapsed_days: 0,
            scheduled_days: 1,
            reps: 0,
            lapses: 0,
            state: 0,
            last_review: null,
          },
          lapses: 0,
          lastReviewAt: 0,
          nextReviewAt: now() + 86400000,
          createdAt: now(),
        });
      }
    }
  });

  return result;
}

// 从 HTML 文件导入（支持 Evernote/印象笔记、Notion 单页导出、通用 HTML）
export async function importFromHtmlFiles(files: File[]): Promise<ImportResult> {
  const { createNote } = await import('@/lib/db/notes');
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  for (const file of files) {
    try {
      const html = await file.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 提取标题
      const title =
        doc.querySelector('title')?.textContent?.trim() ||
        doc.querySelector('h1')?.textContent?.trim() ||
        file.name.replace(/\.html?$/i, '');

      // 提取标签（印象笔记导出格式：meta[name="keywords"]）
      const keywords = doc.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';
      const tags = keywords
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);

      // 移除 script/style，转为 markdown
      doc.querySelectorAll('script, style, meta, link').forEach((el) => el.remove());

      const body = doc.body || doc.documentElement;
      const md = htmlToMarkdown(body);

      await createNote({
        title,
        content: md,
        tags,
        source: 'import',
      });
      result.imported++;
    } catch (err) {
      result.errors.push(`${file.name}: ${(err as Error).message}`);
      result.skipped++;
    }
  }
  return result;
}

// 简易 HTML → Markdown 转换（不引入 turndown 等库，覆盖常见标签）
function htmlToMarkdown(root: ParentNode): string {
  const lines: string[] = [];

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.replace(/\s+/g, ' ') || '';
      if (text.trim()) lines.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    switch (tag) {
      case 'h1': lines.push(`\n# ${el.textContent?.trim()}\n`); return;
      case 'h2': lines.push(`\n## ${el.textContent?.trim()}\n`); return;
      case 'h3': lines.push(`\n### ${el.textContent?.trim()}\n`); return;
      case 'h4': lines.push(`\n#### ${el.textContent?.trim()}\n`); return;
      case 'h5': lines.push(`\n##### ${el.textContent?.trim()}\n`); return;
      case 'h6': lines.push(`\n###### ${el.textContent?.trim()}\n`); return;
      case 'p': lines.push(''); el.childNodes.forEach(walk); lines.push('\n'); return;
      case 'br': lines.push('\n'); return;
      case 'hr': lines.push('\n---\n'); return;
      case 'strong':
      case 'b': lines.push('**'); el.childNodes.forEach(walk); lines.push('**'); return;
      case 'em':
      case 'i': lines.push('*'); el.childNodes.forEach(walk); lines.push('*'); return;
      case 'code': lines.push('`'); el.childNodes.forEach(walk); lines.push('`'); return;
      case 'pre': lines.push('\n```\n'); lines.push(el.textContent || ''); lines.push('\n```\n'); return;
      case 'blockquote': lines.push('\n> '); el.childNodes.forEach(walk); lines.push('\n'); return;
      case 'a': {
        const href = el.getAttribute('href') || '';
        lines.push('[');
        el.childNodes.forEach(walk);
        lines.push(`](${href})`);
        return;
      }
      case 'img': {
        const alt = el.getAttribute('alt') || '';
        const src = el.getAttribute('src') || '';
        lines.push(`![${alt}](${src})`);
        return;
      }
      case 'ul':
      case 'ol': {
        lines.push('\n');
        let i = 1;
        el.childNodes.forEach((child) => {
          if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === 'li') {
            const prefix = tag === 'ol' ? `${i}. ` : '- ';
            lines.push(prefix);
            (child as Element).childNodes.forEach(walk);
            lines.push('\n');
            i++;
          }
        });
        return;
      }
      case 'li': el.childNodes.forEach(walk); return;
      case 'table': {
        const rows = el.querySelectorAll('tr');
        if (rows.length > 0) {
          lines.push('\n');
          rows.forEach((row, ri) => {
            const cells = Array.from(row.querySelectorAll('th, td')).map((c) => c.textContent?.trim() || '');
            lines.push('| ' + cells.join(' | ') + ' |');
            if (ri === 0) lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
          });
          lines.push('\n');
        }
        return;
      }
      case 'div':
      case 'section':
      case 'article':
      case 'body':
        el.childNodes.forEach(walk);
        return;
      default:
        el.childNodes.forEach(walk);
    }
  }

  walk(root);
  // 合并多余空行
  return lines
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80)
    .trim();
}
