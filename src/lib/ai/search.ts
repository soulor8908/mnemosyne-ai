// 混合检索：关键词 + 语义 + RRF 融合
import { getDb } from '@/lib/db/schema';
import { searchNotesByKeyword } from '@/lib/db/notes';
import { getAllEmbeddings } from '@/lib/db/embeddings';
import { cosineSimilarity } from '@/lib/utils';
import { embedLocal, resolveEmbedMode } from './embed';
import { apiFetch } from '@/lib/api/client';
import type { EmbeddingMode } from '@/types';
import type { Note } from '@/types';

export interface SearchResult {
  note: Note;
  score: number;
  matchedBy: 'keyword' | 'semantic' | 'both';
}

// 通过 /api/embed 获取云端嵌入（与笔记存储时的 bge-base-en-v1.5 同模型同维度）
// 修复要点：query 嵌入必须与存储嵌入同维度，否则 cosineSimilarity 恒为 0
async function embedQueryCloud(text: string): Promise<{ vector: number[]; model: string }> {
  const res = await apiFetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`embed query failed: ${res.status}`);
  const json = (await res.json()) as { vector: number[]; model: string };
  return { vector: json.vector, model: json.model };
}

// 根据用户偏好 + 网络可用性选 query 嵌入模式，并返回对应模型名
// 返回 null 表示无法获得语义向量（调用方应降级为纯关键词检索）
async function embedQuery(
  text: string,
  preferredMode: EmbeddingMode
): Promise<{ vector: number[]; model: string } | null> {
  if (preferredMode === 'cloud') {
    try {
      return await embedQueryCloud(text);
    } catch {
      // 网络失败时降级到本地（仅匹配本地模式存储的嵌入）
      try {
        const local = await embedLocal(text);
        return { vector: local.vector, model: local.model };
      } catch {
        return null;
      }
    }
  }
  try {
    const local = await embedLocal(text);
    return { vector: local.vector, model: local.model };
  } catch {
    return null;
  }
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
  // 修复要点：query 嵌入模式必须与笔记存储嵌入模式一致，否则维度不匹配
  // cosineSimilarity 恒返回 0，导致云端模式下语义检索完全失效
  const preferredMode = await resolveEmbedMode();
  const queryEmbed = await embedQuery(query, preferredMode);

  let semanticIds: string[] = [];
  if (queryEmbed) {
    const allEmbeddings = await getAllEmbeddings();
    // 严格按模型过滤，避免 384 维 query 与 768 维存储混合计算
    const sameModelEmbeddings = allEmbeddings.filter(
      (e) => e.model === queryEmbed.model
    );
    semanticIds = sameModelEmbeddings
      .map((e) => ({
        noteId: e.noteId,
        score: cosineSimilarity(queryEmbed.vector, e.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((r) => r.noteId);
  }

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
