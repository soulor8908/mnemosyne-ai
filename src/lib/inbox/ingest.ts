// Inbox 导入器：把 Trae 捕获 Agent 产出的 inbox markdown 文件导入本地笔记库
// 详见 docs/superpowers/specs/2026-07-29-feishu-share-capture-design.md §6
import { getDb } from '@/lib/db/schema';
import { parseInboxFile, isIngestible, toNoteInput } from './parser';
import type { Note } from '@/types';
import type { ImportResult } from '@/lib/markdown/export';

// 从 File 列表批量导入 inbox 文件到本地 Dexie
// - status=inbox 才入库；inbox-raw/ingested 跳过
// - sourceMeta.url 去重，已存在则跳过
// - 串行处理，单个文件失败不阻断其他文件
export async function ingestInboxFiles(files: File[]): Promise<ImportResult> {
  const db = getDb();
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = parseInboxFile(text);
      if (!parsed) {
        result.errors.push(`${file.name}: frontmatter 缺失或格式不合法`);
        result.skipped++;
        continue;
      }

      // status 过滤：只消费 inbox
      if (!isIngestible(parsed)) {
        result.skipped++;
        continue;
      }

      // 去重：sourceMeta.url 已存在则跳过
      const url = parsed.frontmatter.sourceUrl;
      const existing = await db.notes
        .filter((n) => n.sourceMeta?.url === url)
        .first();
      if (existing) {
        result.skipped++;
        continue;
      }

      // 转换并写入
      const input = toNoteInput(parsed);
      const ts = Date.now();
      const note: Note = {
        id: input.id,
        title: input.title,
        content: input.content,
        frontmatter: input.frontmatter,
        folderId: null,
        tags: input.tags,
        status: 'draft',
        source: 'feishu',
        sourceMeta: input.sourceMeta,
        createdAt: ts,
        updatedAt: ts,
        accessedAt: ts,
        rev: 1,
        syncStatus: 'local',
        encryption: 'plain',
      };
      await db.notes.add(note);
      result.imported++;
    } catch (err) {
      result.errors.push(`${file.name}: ${(err as Error).message}`);
      result.skipped++;
    }
  }

  return result;
}
