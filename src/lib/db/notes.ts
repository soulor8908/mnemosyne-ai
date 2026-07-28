// 笔记 DAO
import { getDb } from './schema';
import type { Note, NoteSource } from '@/types';
import { genId, now, extractTitleFromMarkdown } from '@/lib/utils';

export async function createNote(input: {
  title?: string;
  content?: string;
  folderId?: string | null;
  tags?: string[];
  source?: NoteSource;
  sourceMeta?: { url?: string; capturedAt?: number };
}): Promise<Note> {
  const db = getDb();
  const ts = now();
  const content = input.content ?? '';
  const note: Note = {
    id: genId('note'),
    title: input.title ?? extractTitleFromMarkdown(content) ?? '无标题',
    content,
    frontmatter: {},
    folderId: input.folderId ?? null,
    tags: input.tags ?? [],
    status: 'draft',
    source: input.source ?? 'manual',
    sourceMeta: input.sourceMeta,
    createdAt: ts,
    updatedAt: ts,
    accessedAt: ts,
    rev: 1,
    syncStatus: 'local',
    encryption: 'plain',
  };
  await db.notes.add(note);
  return note;
}

export async function getNote(id: string): Promise<Note | undefined> {
  const db = getDb();
  const note = await db.notes.get(id);
  if (note) {
    // 更新 accessedAt（异步，不阻塞）
    db.notes.update(id, { accessedAt: now() });
  }
  return note;
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'folderId' | 'status' | 'frontmatter'>>
): Promise<Note | undefined> {
  const db = getDb();
  const existing = await db.notes.get(id);
  if (!existing) return undefined;

  const updated: Note = {
    ...existing,
    ...patch,
    updatedAt: now(),
    rev: existing.rev + 1,
    syncStatus: 'pending',
  };

  // 自动从内容提取标题（如果用户没改标题）
  if (!patch.title && patch.content !== undefined) {
    updated.title = extractTitleFromMarkdown(patch.content) || existing.title;
  }

  await db.notes.put(updated);

  // 保存快照（自动）
  await db.snapshots.add({
    id: genId('snap'),
    noteId: id,
    content: existing.content,
    createdAt: now(),
    reason: 'auto',
  });

  return updated;
}

export async function deleteNote(id: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.notes, db.bilinks, db.reviewCards, db.snapshots, db.embeddings, db.attachments, async () => {
    await db.notes.delete(id);
    await db.bilinks.where('srcNoteId').equals(id).or('dstNoteId').equals(id).delete();
    await db.reviewCards.where('noteId').equals(id).delete();
    await db.snapshots.where('noteId').equals(id).delete();
    await db.embeddings.where('noteId').equals(id).delete();
    await db.attachments.where('noteId').equals(id).delete();
  });
}

export async function listNotes(opts?: {
  folderId?: string | null;
  status?: Note['status'];
  limit?: number;
  offset?: number;
}): Promise<Note[]> {
  const db = getDb();
  let collection = db.notes.orderBy('updatedAt').reverse();

  if (opts?.folderId !== undefined) {
    collection = collection.filter((n) => n.folderId === opts.folderId);
  }
  if (opts?.status) {
    collection = collection.filter((n) => n.status === opts.status);
  }

  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  const list = await collection.offset(offset).limit(limit).toArray();
  // 置顶优先，其次按 order（降序，null 视为 0），最后按 updatedAt 降序
  return list.sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const oa = a.order ?? 0;
    const ob = b.order ?? 0;
    if (oa !== ob) return ob - oa;
    return b.updatedAt - a.updatedAt;
  });
}

export async function searchNotesByKeyword(query: string, limit = 50): Promise<Note[]> {
  const db = getDb();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return [];

  const all = await db.notes.filter((n) => n.status !== 'archived').toArray();

  const scored = all
    .map((note) => {
      const haystack = (note.title + ' ' + note.content + ' ' + note.tags.join(' ')).toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (note.title.toLowerCase().includes(token)) score += 3;
        if (haystack.includes(token)) score += 1;
      }
      return { note, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((r) => r.note);
}

export async function getRecentNotes(days = 7): Promise<Note[]> {
  const db = getDb();
  const since = now() - days * 24 * 3600 * 1000;
  return db.notes
    .where('updatedAt')
    .above(since)
    .and((n) => n.status !== 'archived')
    .toArray();
}

export async function getPendingSyncNotes(): Promise<Note[]> {
  const db = getDb();
  return db.notes
    .where('syncStatus')
    .anyOf(['pending', 'local'])
    .toArray();
}

export async function markSynced(id: string, rev: number): Promise<void> {
  const db = getDb();
  await db.notes.update(id, { syncStatus: 'synced', rev });
}

export async function countNotes(): Promise<number> {
  const db = getDb();
  return db.notes.count();
}

// 按 ID 列表批量获取笔记
export async function getNotesByIds(ids: string[]): Promise<Note[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const notes = await db.notes.bulkGet(ids);
  return notes.filter((n): n is Note => !!n);
}

// 批量删除笔记
export async function bulkDeleteNotes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db.transaction('rw', db.notes, db.bilinks, db.reviewCards, db.snapshots, db.embeddings, db.attachments, async () => {
    await db.notes.bulkDelete(ids);
    for (const id of ids) {
      await db.bilinks.where('srcNoteId').equals(id).or('dstNoteId').equals(id).delete();
      await db.reviewCards.where('noteId').equals(id).delete();
      await db.snapshots.where('noteId').equals(id).delete();
      await db.embeddings.where('noteId').equals(id).delete();
      await db.attachments.where('noteId').equals(id).delete();
    }
  });
}

// 置顶/取消置顶
export async function togglePinned(id: string, pinned: boolean): Promise<void> {
  const db = getDb();
  const existing = await db.notes.get(id);
  if (!existing) return;
  // 置顶时给一个较大的 order，确保排在前面
  const order = pinned ? Date.now() : existing.order;
  await db.notes.update(id, { pinned, order, syncStatus: 'pending' });
}

// 拖动排序：根据新的 ID 顺序批量更新 order
// orderedIds 是用户拖动后的完整顺序（从前到后）
export async function reorderNotes(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const db = getDb();
  // 从大到小赋 order（前面的 order 大，排前面）
  const base = orderedIds.length;
  await db.transaction('rw', db.notes, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      const note = await db.notes.get(id);
      if (!note) continue;
      // 已置顶的笔记保持其 order（用 Date.now() 范围），不受拖动影响
      if (note.pinned) continue;
      await db.notes.update(id, { order: base - i, syncStatus: 'pending' });
    }
  });
}
