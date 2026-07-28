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
  await db.transaction('rw', db.notes, db.bilinks, db.reviewCards, db.snapshots, db.embeddings, async () => {
    await db.notes.delete(id);
    await db.bilinks.where('srcNoteId').equals(id).or('dstNoteId').equals(id).delete();
    await db.reviewCards.where('noteId').equals(id).delete();
    await db.snapshots.where('noteId').equals(id).delete();
    await db.embeddings.where('noteId').equals(id).delete();
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

  return collection.offset(offset).limit(limit).toArray();
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
