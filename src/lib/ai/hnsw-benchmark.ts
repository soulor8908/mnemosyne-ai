// HNSW vs 暴力搜索 benchmark
//
// 对比 HNSW 近似检索与全量余弦相似度的：
//   1. 查询延迟（ms）
//   2. 召回率（HNSW top-K vs 暴力 top-K 的重叠率）
//   3. 构建时间
//   4. 内存占用
//
// 运行：npx tsx src/lib/ai/hnsw-benchmark.ts
import { HNSWIndex, normalizeVector, type HNSWParams } from './hnsw';
import { cosineSimilarity } from '@/lib/utils';

export interface BenchmarkConfig {
  vectorCount: number;    // 向量数量
  dimensions: number;     // 维度
  topK: number;           // 查询 topK
  queryCount: number;     // 查询次数
  hnswParams: Partial<HNSWParams>;
}

export interface BenchmarkResult {
  config: BenchmarkConfig;
  buildTimeMs: number;
  bruteForce: {
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  hnsw: {
    avgLatencyMs: number;
    p95LatencyMs: number;
    avgRecall: number;    // 平均召回率
    p95Recall: number;
    memoryBytes: number;
    nodeCount: number;
    avgConnections: number;
  };
  speedup: number;        // HNSW 比 暴力快多少倍
}

// 生成随机向量（模拟嵌入）
function generateVectors(count: number, dim: number): number[][] {
  const vectors: number[][] = [];
  for (let i = 0; i < count; i++) {
    const vec = Array.from({ length: dim }, () => Math.random() * 2 - 1);
    vectors.push(normalizeVector(vec));
  }
  return vectors;
}

// 暴力搜索 topK
function bruteForceSearch(
  query: number[],
  vectors: number[][],
  ids: string[],
  topK: number
): Array<{ id: string; score: number }> {
  return vectors
    .map((v, i) => ({ id: ids[i], score: cosineSimilarity(query, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// 计算召回率：HNSW 结果与暴力结果的重叠比例
function recall(hnswResults: string[], bruteResults: string[]): number {
  if (bruteResults.length === 0) return 1;
  const bruteSet = new Set(bruteResults);
  const overlap = hnswResults.filter((id) => bruteSet.has(id)).length;
  return overlap / bruteResults.length;
}

export function runBenchmark(config: BenchmarkConfig): BenchmarkResult {
  const { vectorCount, dimensions, topK, queryCount, hnswParams } = config;

  // 1. 生成向量
  const vectors = generateVectors(vectorCount, dimensions);
  const ids = vectors.map((_, i) => `vec_${i}`);

  // 2. 构建 HNSW 索引
  const buildStart = Date.now();
  const index = new HNSWIndex(hnswParams, 42); // 固定种子
  index.insertBatch(vectors.map((v, i) => ({ id: ids[i], vector: v })));
  const buildTimeMs = Date.now() - buildStart;

  // 3. 生成查询向量
  const queries = generateVectors(queryCount, dimensions);

  // 4. 暴力搜索基准
  const bruteLatencies: number[] = [];
  const bruteTopKs: string[][] = [];
  for (const q of queries) {
    const start = performance.now();
    const results = bruteForceSearch(q, vectors, ids, topK);
    bruteLatencies.push(performance.now() - start);
    bruteTopKs.push(results.map((r) => r.id));
  }

  // 5. HNSW 搜索
  const hnswLatencies: number[] = [];
  const recalls: number[] = [];
  for (let i = 0; i < queries.length; i++) {
    const start = performance.now();
    const results = index.search(queries[i], topK);
    hnswLatencies.push(performance.now() - start);
    recalls.push(recall(results.map((r) => r.id), bruteTopKs[i]));
  }

  // 6. 统计
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const p95 = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  };

  const stats = index.getStats();
  const avgBrute = avg(bruteLatencies);
  const avgHnsw = avg(hnswLatencies);

  return {
    config,
    buildTimeMs,
    bruteForce: { avgLatencyMs: avgBrute, p95LatencyMs: p95(bruteLatencies) },
    hnsw: {
      avgLatencyMs: avgHnsw,
      p95LatencyMs: p95(hnswLatencies),
      avgRecall: avg(recalls),
      p95Recall: p95(recalls),
      memoryBytes: stats.memoryEstimate,
      nodeCount: stats.nodeCount,
      avgConnections: stats.avgConnections,
    },
    speedup: avgBrute / (avgHnsw || 1),
  };
}

// 格式化为 Markdown 报告
export function formatReport(results: BenchmarkResult[]): string {
  const lines: string[] = [];
  lines.push('# HNSW vs 暴力搜索 Benchmark');
  lines.push('');
  lines.push('| 向量数 | 维度 | 构建(ms) | 暴力avg(ms) | HNSW avg(ms) | 加速比 | 召回率avg | 召回率p95 | 内存(KB) |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(
      `| ${r.config.vectorCount} | ${r.config.dimensions} | ${r.buildTimeMs} | ${r.bruteForce.avgLatencyMs.toFixed(3)} | ${r.hnsw.avgLatencyMs.toFixed(3)} | ${r.speedup.toFixed(1)}x | ${(r.hnsw.avgRecall * 100).toFixed(1)}% | ${(r.hnsw.p95Recall * 100).toFixed(1)}% | ${(r.hnsw.memoryBytes / 1024).toFixed(0)} |`
    );
  }
  return lines.join('\n');
}

// 默认 benchmark 配置（模拟真实场景：384维 = all-MiniLM-L6-v2）
export const DEFAULT_CONFIGS: BenchmarkConfig[] = [
  { vectorCount: 100, dimensions: 384, topK: 5, queryCount: 50, hnswParams: { M: 16, efConstruction: 200, efSearch: 50 } },
  { vectorCount: 500, dimensions: 384, topK: 5, queryCount: 50, hnswParams: { M: 16, efConstruction: 200, efSearch: 50 } },
  { vectorCount: 1000, dimensions: 384, topK: 5, queryCount: 50, hnswParams: { M: 16, efConstruction: 200, efSearch: 50 } },
  { vectorCount: 5000, dimensions: 384, topK: 5, queryCount: 50, hnswParams: { M: 16, efConstruction: 200, efSearch: 50 } },
];

// CLI 入口
if (require.main === module) {
  console.log('运行 HNSW benchmark...\n');
  const results = DEFAULT_CONFIGS.map((config) => {
    console.log(`测试 ${config.vectorCount} 条向量...`);
    return runBenchmark(config);
  });
  console.log('\n' + formatReport(results));
}
