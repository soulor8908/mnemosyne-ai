# Mnemosyne Rerank Service

基于 Cross-Encoder（`BAAI/bge-reranker-v2-m3`）的 RAG 检索结果重排服务，对 (query, document) pair 打分并按相关性降序返回 top_n。

> 这是 Mnemosyne（local-first 云笔记）练兵场项目的 Python 栈补充，对应 JD 要求的 **Python + 向量检索重排**。主应用是 Next.js / TypeScript，本服务以独立 Python 微服务形式提供 Cross-Encoder 重排能力，弥补 Bi-Encoder 语义检索精度不足的问题。

## 目录结构

```
services/rerank/
├── app.py             # FastAPI 服务主体
├── requirements.txt   # Python 依赖
├── Dockerfile         # 容器镜像定义
├── test_rerank.py     # pytest API 契约测试（mock 模型）
└── README.md
```

## 端点

| 方法 | 路径       | 说明                                   |
| ---- | ---------- | -------------------------------------- |
| GET  | `/health`  | 健康检查，返回 `{"status":"ok","model":"..."}` |
| POST | `/rerank`  | 接收 query + 候选文档列表，返回重排结果 |

## 本地运行

```bash
cd services/rerank
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
```

首次启动会自动从 HuggingFace 下载 `BAAI/bge-reranker-v2-m3` 模型并缓存到 `~/.cache/huggingface`，后续启动直接复用缓存。

## Docker 运行

```bash
cd services/rerank
docker build -t mnemosyne-rerank .
docker run -p 8001:8001 -v rerank-hf-cache:/root/.cache/huggingface mnemosyne-rerank
```

`-v rerank-hf-cache:/root/.cache/huggingface` 使用命名卷持久化模型缓存，避免重建容器时重复下载。

## API 调用示例

### 健康检查

```bash
curl http://localhost:8001/health
# {"status":"ok","model":"BAAI/bge-reranker-v2-m3"}
```

### 重排

```bash
curl -X POST http://localhost:8001/rerank \
  -H "Content-Type: application/json" \
  -d '{
    "query": "机器学习",
    "documents": [
      "深度学习是机器学习的一个分支",
      "今天天气不错适合出门",
      "神经网络通过反向传播进行训练",
      "机器学习算法包括监督和无监督学习"
    ],
    "top_n": 2
  }'
```

响应示例：

```json
{
  "results": [
    {"index": 3, "score": 0.9876},
    {"index": 0, "score": 0.9123}
  ],
  "model": "BAAI/bge-reranker-v2-m3",
  "latency_ms": 42
}
```

`index` 为文档在原始 `documents` 列表中的下标，`score` 为 Cross-Encoder 相关性分数（越大越相关）。

## 运行测试

```bash
cd services/rerank
pip install -r requirements.txt pytest httpx
python -m pytest test_rerank.py -v
```

测试使用 monkeypatch 把模型替换成 mock（按 query 在 doc 中出现次数打分），不会真正加载大模型，秒级完成。

## 与 Mnemosyne 主应用的集成方式

主应用当前的混合检索（`src/lib/ai/search.ts`）流程为：关键词检索 50 条 + 语义检索 50 条 → RRF 融合 → 取 top-K。集成重排服务的推荐方式：

1. 在 `src/lib/ai/search.ts` 的 `hybridSearch` 中，先把 RRF 融合后的候选扩大到 **top-20**（而非直接 top-5）。
2. 将这 20 条笔记正文 + query 发送到 `http://localhost:8001/rerank`，`top_n=5`。
3. 按返回的 `index` 重排原笔记列表，作为最终 top-5 结果。

示意（仅说明，实际改动留给后续集成任务，不在本服务范围内）：

```ts
// 1. RRF 融合后取 top-20
const top20 = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 20);
const candidates = await Promise.all(top20.map(([id]) => db.notes.get(id)));

// 2. 调用 rerank 服务
const rerankRes = await fetch("http://localhost:8001/rerank", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    query,
    documents: candidates.map((n) => n?.content ?? ""),
    top_n: 5,
  }),
});
const { results } = await rerankRes.json();

// 3. 按 index 重排为最终 top-5
const final = results.map((r: { index: number }) => candidates[r.index]).filter(Boolean);
```

## 性能说明

- **Cross-Encoder vs Bi-Encoder**：Cross-Encoder 把 (query, doc) 拼接后一起送入 Transformer，精度远高于 Bi-Encoder（独立编码后算相似度），但速度慢 **10–100 倍**。
- 因此 Cross-Encoder 不适合做首轮全库检索，只用于对首轮召回的候选做精排。
- **候选数控制在 20 以内**：在 CPU 上 bge-reranker-v2-m3 对 20 条 (query, doc) pair 打分约几十到几百毫秒；GPU 上可降至个位数毫秒。候选超过 50 条时延迟会显著上升。
- 模型在服务启动时加载一次（全局单例），请求时仅做前向推理，避免重复加载开销。

## 模型

- 名称：`BAAI/bge-reranker-v2-m3`
- 来源：BAAI（智源研究院）开源 reranker
- 特点：多语言、轻量级、适合中英文混合场景
