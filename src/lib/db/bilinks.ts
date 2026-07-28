// 双链 DAO
import { getDb } from './schema';
import type { Bilink } from '@/types';
import { genId, now } from '@/lib/utils';

export async function createBilink(input: {
  srcNoteId: string;
  dstNoteId: string;
  type?: Bilink['type'];
  reason?: string;
  confidence?: number;
  createdBy?: Bilink['createdBy'];
}): Promise<Bilink> {
  const db = getDb();
  const bilink: Bilink = {
    id: genId('link'),
    srcNoteId: input.srcNoteId,
    dstNoteId: input.dstNoteId,
    type: input.type ?? 'manual',
    reason: input.reason,
    confidence: input.confidence,
    createdAt: now(),
    createdBy: input.createdBy ?? 'user',
  };
  await db.bilinks.add(bilink);
  return bilink;
}

export async function getBilinksForNote(noteId: string): Promise<Bilink[]> {
  const db = getDb();
  const outgoing = await db.bilinks.where('srcNoteId').equals(noteId).toArray();
  const incoming = await db.bilinks.where('dstNoteId').equals(noteId).toArray();
  return [...outgoing, ...incoming];
}

export async function findBilink(srcId: string, dstId: string): Promise<Bilink | undefined> {
  const db = getDb();
  return db.bilinks
    .where('srcNoteId')
    .equals(srcId)
    .and((b) => b.dstNoteId === dstId)
    .first();
}

export async function deleteBilink(id: string): Promise<void> {
  const db = getDb();
  await db.bilinks.delete(id);
}
