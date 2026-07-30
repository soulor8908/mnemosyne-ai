// 单元测试：HNSW 本地向量索引
import { describe, it, expect, beforeEach } from 'vitest';
import { HNSWIndex, normalizeVector } from '@/lib/ai/hnsw';
import { cosineSimilarity } from '@/lib/utils';

// 生成确定性随机向量（固定种子）
function generateVectors(count: number, dim: number, seed = 42): number[][] {
  let state = seed;
  const rng = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const vectors: number[][] = [];
  for (let i = 0; i < count; i++) {
    const vec = Array.from({ length: dim }, () => rng() * 2 - 1);
    vectors.push(normalizeVector(vec));
  }
  return vectors;
}

// 暴力搜索 topK
function bruteForceTopK(
  query: number[],
  vectors: number[][],
  ids: string[],
  topK: number
): string[] {
  return vectors
    .map((v, i) => ({ id: ids[i], score: cosineSimilarity(query, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r) => r.id);
}

// 召回率
function recall(hnswIds: string[], bruteIds: string[]): number {
  if (bruteIds.length === 0) return 1;
  const bruteSet = new Set(bruteIds);
  return hnswIds.filter((id) => bruteSet.has(id)).length / bruteIds.length;
}

describe('HNSW normalizeVector', () => {
  it('归一化后 L2 范数为 1', () => {
    const v = normalizeVector([3, 4]);
    const norm = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    expect(norm).toBeCloseTo(1, 5);
  });

  it('零向量保持不变', () => {
    const v = normalizeVector([0, 0, 0]);
    expect(v).toEqual([0, 0, 0]);
  });
});

describe('HNSW 基本功能', () => {
  let index: HNSWIndex;

  beforeEach(() => {
    index = new HNSWIndex({ M: 8, efConstruction: 50, efSearch: 20 }, 42);
  });

  it('插入单个节点后可查询到', () => {
    const vec = normalizeVector([1, 0, 0]);
    index.insert('n1', vec);
    const results = index.search(vec, 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('n1');
    expect(results[0].score).toBeCloseTo(1, 2);
  });

  it('空索引查询返回空数组', () => {
    const results = index.search([1, 0, 0], 5);
    expect(results).toHaveLength(0);
  });

  it('批量插入后节点数正确', () => {
    const vectors = generateVectors(100, 64);
    const items = vectors.map((v, i) => ({ id: `v${i}`, vector: v }));
    index.insertBatch(items);
    const stats = index.getStats();
    expect(stats.nodeCount).toBe(100);
  });

  it('查询返回的 topK 不超过请求数', () => {
    const vectors = generateVectors(50, 64);
    index.insertBatch(vectors.map((v, i) => ({ id: `v${i}`, vector: v })));
    const results = index.search(vectors[0], 10);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('查询自身向量应返回 score 接近 1', () => {
    const vectors = generateVectors(20, 64);
    index.insertBatch(vectors.map((v, i) => ({ id: `v${i}`, vector: v })));
    const results = index.search(vectors[5], 1);
    expect(results[0].score).toBeGreaterThan(0.99);
  });
});

describe('HNSW 召回率', () => {
  it('100 条向量 top-5 召回率 >= 80%', () => {
    const dim = 64;
    const vectors = generateVectors(100, dim);
    const ids = vectors.map((_, i) => `v${i}`);
    const index = new HNSWIndex({ M: 16, efConstruction: 100, efSearch: 50 }, 42);
    index.insertBatch(vectors.map((v, i) => ({ id: ids[i], vector: v })));

    const queries = generateVectors(20, dim);
    let totalRecall = 0;
    for (const q of queries) {
      const bruteIds = bruteForceTopK(q, vectors, ids, 5);
      const hnswIds = index.search(q, 5).map((r) => r.id);
      totalRecall += recall(hnswIds, bruteIds);
    }
    const avgRecall = totalRecall / queries.length;
    // HNSW 是近似的，80% 召回率是合理下限
    expect(avgRecall).toBeGreaterThanOrEqual(0.8);
  });

  it('500 条向量 top-5 召回率 >= 75%', () => {
    const dim = 64;
    const vectors = generateVectors(500, dim);
    const ids = vectors.map((_, i) => `v${i}`);
    const index = new HNSWIndex({ M: 16, efConstruction: 100, efSearch: 50 }, 42);
    index.insertBatch(vectors.map((v, i) => ({ id: ids[i], vector: v })));

    const queries = generateVectors(20, dim);
    let totalRecall = 0;
    for (const q of queries) {
      const bruteIds = bruteForceTopK(q, vectors, ids, 5);
      const hnswIds = index.search(q, 5).map((r) => r.id);
      totalRecall += recall(hnswIds, bruteIds);
    }
    const avgRecall = totalRecall / queries.length;
    expect(avgRecall).toBeGreaterThanOrEqual(0.75);
  });

  it('efSearch 越大召回率越高', () => {
    const dim = 64;
    const vectors = generateVectors(200, dim);
    const ids = vectors.map((_, i) => `v${i}`);
    const queries = generateVectors(10, dim);

    // 小 efSearch
    const indexSmall = new HNSWIndex({ M: 8, efConstruction: 50, efSearch: 10 }, 42);
    indexSmall.insertBatch(vectors.map((v, i) => ({ id: ids[i], vector: v })));
    let recallSmall = 0;
    for (const q of queries) {
      const bruteIds = bruteForceTopK(q, vectors, ids, 5);
      recallSmall += recall(indexSmall.search(q, 5).map((r) => r.id), bruteIds);
    }
    recallSmall /= queries.length;

    // 大 efSearch
    const indexLarge = new HNSWIndex({ M: 8, efConstruction: 50, efSearch: 100 }, 42);
    indexLarge.insertBatch(vectors.map((v, i) => ({ id: ids[i], vector: v })));
    let recallLarge = 0;
    for (const q of queries) {
      const bruteIds = bruteForceTopK(q, vectors, ids, 5);
      recallLarge += recall(indexLarge.search(q, 5).map((r) => r.id), bruteIds);
    }
    recallLarge /= queries.length;

    expect(recallLarge).toBeGreaterThanOrEqual(recallSmall);
  });
});

describe('HNSW 序列化', () => {
  it('序列化后反序列化，查询结果一致', () => {
    const vectors = generateVectors(50, 32);
    const index1 = new HNSWIndex({ M: 8, efConstruction: 50, efSearch: 20 }, 42);
    index1.insertBatch(vectors.map((v, i) => ({ id: `v${i}`, vector: v })));

    const serialized = index1.serialize();
    const index2 = new HNSWIndex({}, 42);
    index2.deserialize(serialized);

    const query = vectors[0];
    const results1 = index1.search(query, 5);
    const results2 = index2.search(query, 5);
    expect(results1.map((r) => r.id)).toEqual(results2.map((r) => r.id));
  });
});

describe('HNSW 统计信息', () => {
  it('getStats 返回正确信息', () => {
    const vectors = generateVectors(100, 64);
    const index = new HNSWIndex({ M: 16, efConstruction: 100, efSearch: 50 }, 42);
    index.insertBatch(vectors.map((v, i) => ({ id: `v${i}`, vector: v })));

    const stats = index.getStats();
    expect(stats.nodeCount).toBe(100);
    expect(stats.maxLevel).toBeGreaterThanOrEqual(0);
    expect(stats.avgConnections).toBeGreaterThan(0);
    expect(stats.memoryEstimate).toBeGreaterThan(0);
  });

  it('clear 后索引为空', () => {
    const vectors = generateVectors(10, 16);
    const index = new HNSWIndex({ M: 8, efConstruction: 50, efSearch: 20 }, 42);
    index.insertBatch(vectors.map((v, i) => ({ id: `v${i}`, vector: v })));
    index.clear();
    expect(index.getStats().nodeCount).toBe(0);
    expect(index.search(vectors[0], 5)).toHaveLength(0);
  });
});
