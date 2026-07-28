// 嵌入 DAO
import { getDb } from './schema';
import type { EmbeddingRecord, EmbeddingModel, EmbeddingMode } from '@/types';
import { sha256 } from '@/lib/utils';

export async function getEmbedding(noteId: string): Promise<EmbeddingRecord | undefined> {
  const db = getDb();
  return db.embeddings.get(noteId);
}

export async function saveEmbedding(record: EmbeddingRecord): Promise<void> {
  const db = getDb();
  await db.embeddings.put(record);
}

export async function ensureEmbedding(
  noteId: string,
  content: string,
  generateFn: (text: string) => Promise<{ vector: number[]; model: EmbeddingModel; mode: EmbeddingMode }>
): Promise<EmbeddingRecord | undefined> {
  const db = getDb();
  const contentHash = await sha256(content);
  const existing = await db.embeddings.get(noteId);

  if (existing?.contentHash === contentHash) return existing;

  const { vector, model, mode } = await generateFn(content);
  const record: EmbeddingRecord = {
    noteId,
    model,
    vector,
    contentHash,
    generatedAt: Date.now(),
    mode,
  };
  await db.embeddings.put(record);
  return record;
}

export async function getAllEmbeddings(): Promise<EmbeddingRecord[]> {
  const db = getDb();
  return db.embeddings.toArray();
}

export async function deleteEmbedding(noteId: string): Promise<void> {
  const db = getDb();
  await db.embeddings.delete(noteId);
}
