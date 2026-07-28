// 混合检索：关键词 + 语义 + RRF 融合
import { getDb } from '@/lib/db/schema';
import { searchNotesByKeyword } from '@/lib/db/notes';
import { getAllEmbeddings } from '@/lib/db/embeddings';
import { cosineSimilarity } from '@/lib/utils';
import { embedLocal } from './embed';
import type { Note } from '@/types';

export interface SearchResult {
  note: Note;
  score: number;
  matchedBy: 'keyword' | 'semantic' | 'both';
}

// RRF 融合
function rrfFusion(
  listA: string[],
  listB: string[],
  k = 60
): Map<string, { score: number; sources: ('keyword' | 'semantic')[] }> {
  const scores = new Map<string, { score: number; sources: ('keyword' | 'semantic')[] }>();
  listA.forEach((id, i) => {
    const existing = scores.get(id) ?? { score: 0, sources: [] };
    existing.score += 1 / (k + i);
    if (!existing.sources.includes('keyword')) existing.sources.push('keyword');
    scores.set(id, existing);
  });
  listB.forEach((id, i) => {
    const existing = scores.get(id) ?? { score: 0, sources: [] };
    existing.score += 1 / (k + i);
    if (!existing.sources.includes('semantic')) existing.sources.push('semantic');
    scores.set(id, existing);
  });
  return scores;
}

export async function hybridSearch(
  query: string,
  topK = 5
): Promise<SearchResult[]> {
  const db = getDb();

  // 1. 关键词检索
  const keywordResults = await searchNotesByKeyword(query, 50);
  const keywordIds = keywordResults.map((n) => n.id);

  // 2. 语义检索
  const queryVec = (await embedLocal(query)).vector;
  const allEmbeddings = await getAllEmbeddings();
  const semanticResults = allEmbeddings
    .map((e) => ({
      noteId: e.noteId,
      score: cosineSimilarity(queryVec, e.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
  const semanticIds = semanticResults.map((r) => r.noteId);

  // 3. RRF 融合
  const fused = rrfFusion(keywordIds, semanticIds);
  const topIds = [...fused.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK);

  // 4. 加载笔记
  const results: SearchResult[] = [];
  for (const [noteId, info] of topIds) {
    const note = await db.notes.get(noteId);
    if (!note) continue;
    results.push({
      note,
      score: info.score,
      matchedBy: info.sources.length === 2 ? 'both' : info.sources[0],
    });
  }

  return results;
}

// 简单关键词搜索（无向量时降级）
export async function keywordSearch(query: string, topK = 10): Promise<SearchResult[]> {
  const notes = await searchNotesByKeyword(query, topK);
  return notes.map((note) => ({
    note,
    score: 1,
    matchedBy: 'keyword' as const,
  }));
}
