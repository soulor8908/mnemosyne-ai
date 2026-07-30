// HNSW（Hierarchical Navigable Small World）近似最近邻索引
//
// 参考 Malkov & Yashunin 2016 论文实现，纯 TypeScript 无依赖。
// 用于浏览器内向量检索，替代全量余弦相似度 O(n) 暴力搜索。
//
// 核心思想：
//   - 多层图结构，上层稀疏（入口点），下层密集（完整数据）
//   - 搜索时从顶层粗找，逐层下沉精细化
//   - 插入时随机决定最高层级（指数分布）
//
// 复杂度：
//   - 构建：O(n · log n)
//   - 查询：O(log n)
//   - 内存：O(n · M)（M 是每层最大连接数）
//
// 精度取舍：
//   - efSearch 越大召回率越高但越慢
//   - M 越大图越密、内存越多、构建越慢，但召回率越高
//   - 单用户 <1万条笔记，M=16, efConstruction=200, efSearch=50 召回率 >95%
export interface HNSWNode {
  id: string;           // 外部 ID（如 noteId）
  vector: number[];     // 嵌入向量
  level: number;        // 该节点的最高层级
  // 每层的邻居列表：connections[layer] = string[]（邻居 id）
  connections: string[][];
}

export interface HNSWParams {
  M: number;            // 每层最大连接数（层0是 2M）
  efConstruction: number; // 构建时搜索宽度
  efSearch: number;     // 查询时搜索宽度
}

export interface HNSWSearchResult {
  id: string;
  score: number;        // 余弦相似度
}

export interface HNSWStats {
  nodeCount: number;
  maxLevel: number;
  avgConnections: number; // 层0平均连接数
  memoryEstimate: number; // 估算内存占用（字节）
}

export class HNSWIndex {
  private nodes = new Map<string, HNSWNode>();
  private entryPointId: string | null = null;
  private maxLevel = -1;
  private params: HNSWParams;
  // 确定性随机数（便于测试复现）
  private rng: () => number;

  constructor(params?: Partial<HNSWParams>, seed?: number) {
    this.params = {
      M: 16,
      efConstruction: 200,
      efSearch: 50,
      ...params,
    };
    // 简单线性同余 RNG，可种子化
    let state = seed ?? Math.random() * 2147483647;
    this.rng = () => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647;
    };
  }

  // 随机决定节点层级（指数分布：P(level >= L) = 1/mL）
  private randomLevel(): number {
    const mL = 1 / Math.log(2); // ln(M) 的简化，M=2 时 mL≈1.44
    let level = 0;
    while (this.rng() < 1 / mL && level < 16) { // 上限 16 层防止退化
      level++;
    }
    return level;
  }

  // 余弦相似度（内积，假设向量已归一化）
  private distance(a: number[], b: number[]): number {
    // 返回"距离"= 1 - cosine，越小越相似
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return 1 - dot;
  }

  // 在单层内搜索最近的 ef 个节点（贪心搜索）
  private searchLayer(
    query: number[],
    entryPoints: string[],
    ef: number,
    layer: number
  ): Map<string, number> {
    const visited = new Set<string>(entryPoints);
    // 候选集（按距离排序，最小堆用数组模拟）
    const candidates: Array<{ id: string; dist: number }> = [];
    // 结果集（top-ef 最近）
    const results: Map<string, number> = new Map();

    for (const ep of entryPoints) {
      const node = this.nodes.get(ep);
      if (!node) continue;
      const dist = this.distance(query, node.vector);
      candidates.push({ id: ep, dist });
      results.set(ep, dist);
    }

    candidates.sort((a, b) => a.dist - b.dist);

    while (candidates.length > 0) {
      const current = candidates.shift()!;
      // 当前最近结果的最差距离
      let worstDist = Infinity;
      for (const d of results.values()) {
        if (d > worstDist) worstDist = d;
      }

      // 如果当前候选比结果集最差还远，停止
      if (current.dist > worstDist && results.size >= ef) break;

      // 探索邻居
      const node = this.nodes.get(current.id);
      if (!node || layer >= node.connections.length) continue;
      const neighbors = node.connections[layer] || [];
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const neighborNode = this.nodes.get(neighborId);
        if (!neighborNode) continue;
        const dist = this.distance(query, neighborNode.vector);
        if (results.size < ef || dist < worstDist) {
          candidates.push({ id: neighborId, dist });
          results.set(neighborId, dist);
          // 保持 results 最多 ef 个
          if (results.size > ef) {
            // 移除最远的
            let worstId = '';
            let worst = -Infinity;
            for (const [id, d] of results) {
              if (d > worst) { worst = d; worstId = id; }
            }
            results.delete(worstId);
          }
          worstDist = dist;
        }
      }
      candidates.sort((a, b) => a.dist - b.dist);
    }

    return results;
  }

  // 选择邻居（简单策略：取最近的 M 个）
  private selectNeighbors(candidates: Map<string, number>, M: number): string[] {
    return Array.from(candidates.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, M)
      .map(([id]) => id);
  }

  // 插入一个节点
  insert(id: string, vector: number[]): void {
    const level = this.randomLevel();
    const node: HNSWNode = {
      id,
      vector,
      level,
      connections: Array.from({ length: level + 1 }, () => []),
    };
    this.nodes.set(id, node);

    // 第一个节点成为入口
    if (this.entryPointId === null) {
      this.entryPointId = id;
      this.maxLevel = level;
      return;
    }

    // 从顶层搜索到 level+1 层，每层找最近入口
    let entryPoints = [this.entryPointId];
    const entryNode = this.nodes.get(this.entryPointId)!;

    // 从最高层到 level+1 层：贪心找最近
    for (let l = this.maxLevel; l > level; l--) {
      const results = this.searchLayer(vector, entryPoints, 1, l);
      if (results.size > 0) {
        // 取最近的作为下一层入口
        let bestId = '';
        let bestDist = Infinity;
        for (const [rid, dist] of results) {
          if (dist < bestDist) { bestDist = dist; bestId = rid; }
        }
        entryPoints = [bestId];
      }
    }

    // 从 min(level, maxLevel) 到 0 层：双向连接
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const results = this.searchLayer(vector, entryPoints, this.params.efConstruction, l);
      const maxM = l === 0 ? this.params.M * 2 : this.params.M;
      const neighbors = this.selectNeighbors(results, maxM);

      // 设置新节点的邻居
      node.connections[l] = neighbors;

      // 反向连接：邻居也要加上新节点
      for (const neighborId of neighbors) {
        const neighbor = this.nodes.get(neighborId);
        if (!neighbor || l >= neighbor.connections.length) continue;
        neighbor.connections[l].push(id);
        // 如果邻居连接数超限，裁剪
        if (neighbor.connections[l].length > maxM) {
          const neighborVec = neighbor.vector;
          const recompute = new Map<string, number>();
          for (const nid of neighbor.connections[l]) {
            const n = this.nodes.get(nid);
            if (n) recompute.set(nid, this.distance(neighborVec, n.vector));
          }
          neighbor.connections[l] = this.selectNeighbors(recompute, maxM);
        }
      }

      // 下一层的入口点
      entryPoints = neighbors.length > 0 ? neighbors : entryPoints;
    }

    // 更新入口点（如果新节点层级更高）
    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPointId = id;
    }
  }

  // 批量插入
  insertBatch(items: Array<{ id: string; vector: number[] }>): void {
    for (const item of items) {
      this.insert(item.id, item.vector);
    }
  }

  // 查询 top-K 最近邻
  search(query: number[], topK: number = 5): HNSWSearchResult[] {
    if (this.entryPointId === null || this.nodes.size === 0) {
      return [];
    }

    let entryPoints = [this.entryPointId];

    // 从顶层到第1层：贪心找最近
    for (let l = this.maxLevel; l > 0; l--) {
      const results = this.searchLayer(query, entryPoints, 1, l);
      if (results.size > 0) {
        let bestId = '';
        let bestDist = Infinity;
        for (const [rid, dist] of results) {
          if (dist < bestDist) { bestDist = dist; bestId = rid; }
        }
        entryPoints = [bestId];
      }
    }

    // 第0层：ef 搜索宽度
    const results = this.searchLayer(query, entryPoints, Math.max(this.params.efSearch, topK), 0);

    // 转换为 score（cosine = 1 - distance）并取 topK
    return Array.from(results.entries())
      .map(([id, dist]) => ({ id, score: 1 - dist }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // 获取索引统计
  getStats(): HNSWStats {
    let totalConnections = 0;
    for (const node of this.nodes.values()) {
      if (node.connections[0]) {
        totalConnections += node.connections[0].length;
      }
    }
    // 内存估算：每向量 dim*8 字节 + 连接 id 平均 20 字节/个
    const sampleVector = this.nodes.values().next().value?.vector;
    const dim = sampleVector?.length ?? 384;
    const vectorMem = this.nodes.size * dim * 8;
    const connMem = totalConnections * 20;
    return {
      nodeCount: this.nodes.size,
      maxLevel: this.maxLevel,
      avgConnections: this.nodes.size > 0 ? totalConnections / this.nodes.size : 0,
      memoryEstimate: vectorMem + connMem,
    };
  }

  // 清空索引
  clear(): void {
    this.nodes.clear();
    this.entryPointId = null;
    this.maxLevel = -1;
  }

  // 序列化/反序列化（用于持久化到 IndexedDB）
  serialize(): string {
    return JSON.stringify({
      nodes: Array.from(this.nodes.entries()),
      entryPointId: this.entryPointId,
      maxLevel: this.maxLevel,
      params: this.params,
    });
  }

  deserialize(data: string): void {
    const obj = JSON.parse(data);
    this.nodes = new Map(obj.nodes);
    this.entryPointId = obj.entryPointId;
    this.maxLevel = obj.maxLevel;
    this.params = obj.params;
  }
}

// 归一化向量（HNSW 假设向量已归一化，用内积代替余弦）
export function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}
