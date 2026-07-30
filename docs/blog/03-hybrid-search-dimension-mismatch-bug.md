# 混合检索的坑：query 嵌入维度不匹配导致语义检索失效

> 这是我做 [Mnemosyne](https://github.com/soulor8908/mnemosyne-ai) 混合检索时踩过最隐蔽的一个 bug：**所有代码都不报错，所有测试都通过，但语义检索实际返回的全是关键词结果——因为 query 向量和存储向量的维度不匹配，余弦相似度恒为 0**。
>
> 这篇文章讲清楚这个 bug 怎么发生的、为什么测试没拦住、怎么修的、以及更重要的——**怎么从架构层面防止这类"静默失败"**。这是 RAG 工程里最典型的一类问题，面试官问"你 RAG 踩过什么坑"时，这个答案比"加了重排"值钱得多。

## 一、背景：我的混合检索架构

Mnemosyne 的检索是**关键词 + 语义 + RRF 融合**的混合检索。设计很标准：

```
query
  ├──► 关键词检索（Dexie 索引）──► keywordIds[]
  ├──► 语义检索（向量 + cosine）──► semanticIds[]
  └──► RRF 融合两路结果 ──► topK
```

两种嵌入模式：
- **云端模式**：Cloudflare Workers AI，`@cf/baai/bge-base-en-v1.5`，**768 维**
- **本地模式**：`@xenova/transformers`，`Xenova/all-MiniLM-L6-v2`，**384 维**

用户在设置里切换隐私模式时，嵌入模式会变。

## 二、Bug 现象：语义检索静默失效

现象很诡异：**用户报告"搜不到语义相关的笔记，只能搜到关键词命中的"**。

但代码看起来完全正常：
- 关键词检索有结果
- 语义检索没报错
- RRF 融合也跑了
- 测试全绿

这就是最危险的 bug 类型——**静默失败**。没有异常，没有日志，只是结果错了。

## 三、定位：维度不匹配

翻到 `cosineSimilarity` 的实现，第一行就是答案：

```typescript
// src/lib/utils/index.ts
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;  // ← 维度不同直接返回 0
  // ...
}
```

**当 query 向量是 384 维（本地模式），而存储向量是 768 维（云端模式）时，`a.length !== b.length` 永远成立，cosineSimilarity 永远返回 0。**

所有笔记的语义得分都是 0，排序后取 top 50——其实是随便取了 50 个（稳定排序下是插入顺序）。语义检索名义上跑了，实际贡献为零。最终结果只剩关键词那一路。

## 四、为什么会发生：模式切换的历史遗留

根因是**嵌入模式可切换，但已存储的向量不会重新生成**。

时间线：
1. 用户首次用云端模式，所有笔记生成 768 维向量，model = `bge-base-en-v1.5`
2. 用户切换到本地模式（隐私模式）
3. 新笔记生成 384 维向量，model = `local-mini`
4. 用户搜索——query 走本地模式生成 384 维向量
5. query(384) vs 存储(768) 维度不匹配，cosine 全 0
6. 语义检索静默失效

**更糟的情况**：同一用户的不同笔记可能混着 768 维和 384 维向量。query 是哪个模式，就跟那个模式的向量匹配，另一个模式的向量全部被忽略——用户感觉"有些笔记就是搜不到"。

## 五、为什么测试没拦住

这是最值得反思的部分。我有 RRF 融合的单元测试：

```typescript
// tests/unit/rrf-fusion.test.ts
it('双列表重叠：重叠项分数叠加，标记为 both', () => {
  const map = rrfFusion(['n1', 'n2'], ['n2', 'n3']);
  // ...
});
```

测试全绿，因为 **RRF 融合算法本身是对的**——它只接收 ID 列表，不关心这些 ID 怎么来的。

问题出在**测试边界**：我测了融合算法，但没测"语义检索的 ID 列表是否真的有语义意义"。`semanticIds` 在测试里是硬编码的 `['n2', 'n3']`，不是真实 cosineSimilarity 算出来的。

**教训**：单元测试测的是"组件正确性"，但**组件间的契约**（query 嵌入必须与存储嵌入同维度）没有被任何测试覆盖。这类 bug 发生在组件边界，单测天然盲区。

## 六、修复：三层防御

### 6.1 第一层：严格按模型过滤

修复的第一步是**绝不混用不同模型的向量**：

```typescript
// src/lib/ai/search.ts（修复后）
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
```

`e.model === queryEmbed.model` 这一行是关键——**只跟同模型的向量比**。query 是 `local-mini` 就只匹配 `local-mini` 的存储向量，query 是 `bge-base-en-v1.5` 就只匹配 `bge-base-en-v1.5` 的。

代价是：切换模式后，旧模式的向量暂时搜不到，直到用户重新生成。但这是**正确的静默**——宁可少召回，不能假召回。

### 6.2 第二层：模式切换时降级而非混用

`embedQuery` 函数处理了模式降级：

```typescript
async function embedQuery(
  text: string,
  preferredMode: EmbeddingMode
): Promise<{ vector: number[]; model: string } | null> {
  if (preferredMode === 'cloud') {
    try {
      return await embedQueryCloud(text);  // 768 维
    } catch {
      // 网络失败时降级到本地（仅匹配本地模式存储的嵌入）
      try {
        const local = await embedLocal(text);  // 384 维
        return { vector: local.vector, model: local.model };
      } catch {
        return null;  // 全失败，调用方降级为纯关键词
      }
    }
  }
  // ... 本地模式逻辑
}
```

注意：**降级时 model 字段跟着变**。如果云端挂了降级到本地，返回的 model 是 `local-mini`，第一层过滤就只会匹配 384 维的存储向量。**降级链路里 model 标签是正确传播的，不会出现 384 维 query 去匹配 768 维存储的情况**。

### 6.3 第三层：null 表示无法语义检索

如果嵌入彻底失败，`embedQuery` 返回 `null`，调用方跳过语义检索：

```typescript
let semanticIds: string[] = [];
if (queryEmbed) {  // null 时不进语义检索
  // ... 语义检索逻辑
}
// semanticIds 保持空数组，RRF 融合时只有关键词结果
```

**不报错，不假数据，诚实降级**。这是工程姿态——失败要可见，不能装作没事。

## 七、为什么 cosineSimilarity 的 `return 0` 是对的

有人会问：`cosineSimilarity` 维度不匹配时 `return 0` 是不是 bug 根源？应该 throw 吗？

**不，`return 0` 是对的**。cosine 相似度的定义域是 [-1, 1]，0 表示正交（无关）。维度不匹配的向量本质上是"不可比较的"，返回 0（无关）比 throw 更符合数学直觉——上层逻辑能继续跑，只是这条 pair 不贡献语义信号。

**真正的 bug 在调用方**：调用方应该保证不会把不同维度的向量送进来比。`return 0` 是防御性编程，`filter(model ===)` 才是根治。

## 八、更深层教训：静默失败的架构防护

这个 bug 让我想清楚一件事：**RAG 系统里最危险的不是报错，是不报错但结果错**。

### 8.1 加可观测性

修复后，如果同模型的向量少于阈值，应该打 warning：

```typescript
if (sameModelEmbeddings.length === 0 && allEmbeddings.length > 0) {
  console.warn(
    `[search] 有 ${allEmbeddings.length} 条嵌入但无一条匹配 query 模型 ${queryEmbed.model}，` +
    `可能用户切换了嵌入模式但未重新生成向量`
  );
}
```

这能把"静默失效"变成"有迹可循"。**工程上，warn 比 error 有用**——error 会中断流程，warn 让你看到问题但继续跑。

### 8.2 测试组件契约

这个 bug 后，我加了一个集成测试：**用真实嵌入（mock 但同维度）跑完整 hybridSearch，断言 semanticIds 非空**。

```typescript
it('query 与存储同模型时，语义检索应返回非空结果', async () => {
  // 存 3 条 768 维向量，query 也走 768 维
  // 断言 semanticIds.length > 0
});
```

**测的不是算法，是契约**——"同模型 query 必须能匹配到同模型存储"。这类测试是单测的盲区，必须靠集成测试补。

### 8.3 模式切换要显式

理想情况下，切换嵌入模式时应该：
1. 提示用户"现有向量将无法被语义检索"
2. 提供一键重新生成所有向量的按钮
3. 或者在后台异步重新生成

我目前只做了第一层（过滤）和第二层（降级），第三层（UX 提示）是 TODO。**架构正确不等于体验正确**。

## 九、RRF 融合：顺带讲清楚

既然讲到混合检索，顺带把 RRF 融合讲清楚——这是面试高频题。

RRF（Reciprocal Rank Fusion）的核心思想：**不看分数，只看排名**。两个检索系统分数尺度不同（关键词是命中数，语义是 cosine 0-1），直接加没意义。RRF 用排名的倒数做分数，尺度无关。

```typescript
export function rrfFusion(
  listA: string[],  // 关键词结果（按相关性排好）
  listB: string[],  // 语义结果（按相似度排好）
  k = 60            // 平滑常数
): Map<string, { score: number; sources: ('keyword' | 'semantic')[] }> {
  const scores = new Map<string, { score: number; sources: ('keyword' | 'semantic')[] }>();
  listA.forEach((id, i) => {
    const existing = scores.get(id) ?? { score: 0, sources: [] };
    existing.score += 1 / (k + i);  // 排名越靠前分数越高
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
```

**为什么是 `1/(k+i)` 而不是 `1/i`？** 因为 `1/i` 在 i=0 时无穷大，k=60 是平滑常数，让第一名分数 ≈ 0.016 而非无穷。**k 越大，靠后排名的惩罚越轻**——这是我测试里验证过的：

```typescript
it('k 参数影响分数尺度', () => {
  const small = rrfFusion(['a', 'b'], []);
  const large = rrfFusion(['a', 'b'], [], 200);
  expect(large.get('a')!.score).toBeLessThan(small.get('a')!.score);
  // a、b 之间的相对差距在 k 更大时更小
  const diffSmall = small.get('a')!.score - small.get('b')!.score;
  const diffLarge = large.get('a')!.score - large.get('b')!.score;
  expect(diffLarge).toBeLessThan(diffSmall);
});
```

**两路都命中的笔记标记为 `both`**——这是最有价值的召回，说明关键词和语义都认为它相关。

## 十、Bug 复盘的核心教训

| 教训 | 具体表现 | 防护 |
|---|---|---|
| **静默失败最危险** | cosine 返回 0 不报错，语义检索假运行 | 加可观测性，warn 异常状态 |
| **单测有盲区** | RRF 算法测了，但组件契约没测 | 补集成测试，断言端到端行为 |
| **多模式系统要防混用** | 384/768 维向量混存 | 严格按模型过滤，不混用 |
| **降级要带标签** | 降级到本地时 model 要跟着变 | 降级链路里 model 正确传播 |
| **0 是合法返回值** | cosine 维度不匹配返回 0 是对的 | 根治在调用方，不在 cosine |

## 十一、一句话总结

**RAG 系统里，"不报错但结果错"比"报错"危险 10 倍**。维度不匹配导致 cosine 恒 0 这个 bug，表面是向量问题，根因是**多模式系统里缺少"模式一致性"的架构约束**。修复不是加个 if，而是建立三层防御：模型过滤、降级带标签、诚实返回 null。

面试时讲到这个 bug，比讲"我用了 RAG"有深度得多——它证明你**踩过真实的工程坑，并且想清楚了架构层面的防护**。

---

**项目地址**：[github.com/soulor8908/mnemosyne-ai](https://github.com/soulor8908/mnemosyne-ai)
**相关代码**：
- [src/lib/ai/search.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/ai/search.ts) — 混合检索 + 修复注释
- [src/lib/ai/embed.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/ai/embed.ts) — 双模式嵌入
- [src/lib/utils/index.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/src/lib/utils/index.ts) — `cosineSimilarity` 的 `return 0`
- [tests/unit/rrf-fusion.test.ts](https://github.com/soulor8908/mnemosyne-ai/blob/main/tests/unit/rrf-fusion.test.ts) — RRF 融合测试

**上一篇**：[《从 0 到 1 写一个标准 MCP Server》](./02-mcp-server-from-scratch.md)
**下一篇预告**：《RAGAS 实战：给 RAG 系统装上仪表盘》
