"""Mnemosyne Rerank 服务.

基于 Cross-Encoder 的重排服务，用于 RAG 检索结果重排。
使用 sentence-transformers 加载 BAAI/bge-reranker-v2-m3 模型，
对 (query, document) pair 打分并按分数降序返回 top_n。

启动：uvicorn app:app --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, List

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sentence_transformers import CrossEncoder

# 全局模型名常量
MODEL_NAME: str = "BAAI/bge-reranker-v2-m3"


# ---------------------------------------------------------------------------
# 请求 / 响应 schema
# ---------------------------------------------------------------------------
class RerankRequest(BaseModel):
    """重排请求体."""

    query: str = Field(..., description="查询文本")
    documents: List[str] = Field(..., description="候选文档正文列表")
    top_n: int = Field(default=5, ge=1, description="返回前 N 条")


class RerankItem(BaseModel):
    """单条重排结果."""

    index: int = Field(..., description="原始候选列表中的下标")
    score: float = Field(..., description="Cross-Encoder 打分")


class RerankResponse(BaseModel):
    """重排响应体."""

    results: List[RerankItem]
    model: str
    latency_ms: int


class HealthResponse(BaseModel):
    """健康检查响应体."""

    status: str
    model: str


# ---------------------------------------------------------------------------
# 模型加载（启动时加载一次，全局单例）
# ---------------------------------------------------------------------------
_model: CrossEncoder | None = None


def get_model() -> CrossEncoder:
    """获取全局 Cross-Encoder 模型单例.

    首次调用时从 HuggingFace 下载并缓存模型，后续请求复用同一实例。
    """
    global _model
    if _model is None:
        # 首次启动会自动下载并缓存到 ~/.cache/huggingface
        _model = CrossEncoder(MODEL_NAME)
    return _model


# ---------------------------------------------------------------------------
# FastAPI 应用
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """应用生命周期：启动时预加载模型，避免首个请求阻塞过久."""
    get_model()
    yield


app: FastAPI = FastAPI(
    title="Mnemosyne Rerank Service",
    description="基于 Cross-Encoder (bge-reranker-v2-m3) 的 RAG 重排服务",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """健康检查端点."""
    return HealthResponse(status="ok", model=MODEL_NAME)


@app.post("/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest) -> RerankResponse:
    """对候选文档用 Cross-Encoder 重排.

    逻辑：
      1. 构造 (query, doc) pair 列表
      2. 用 Cross-Encoder 打分
      3. 按分数降序，取 top_n
      4. 记录延迟（毫秒）
    """
    start: float = time.perf_counter()

    model: CrossEncoder = get_model()

    # 空候选保护：直接返回空结果
    if not req.documents:
        latency_ms: int = int((time.perf_counter() - start) * 1000)
        return RerankResponse(results=[], model=MODEL_NAME, latency_ms=latency_ms)

    # 构造 (query, doc) pair 并批量打分
    pairs: List[List[str]] = [[req.query, doc] for doc in req.documents]
    scores: Any = model.predict(pairs)

    # 组装 (原始下标, 分数) 并按分数降序
    ranked: List[RerankItem] = [
        RerankItem(index=i, score=float(s))
        for i, s in enumerate(scores)
    ]
    ranked.sort(key=lambda x: x.score, reverse=True)
    top_results: List[RerankItem] = ranked[: req.top_n]

    latency_ms = int((time.perf_counter() - start) * 1000)
    return RerankResponse(results=top_results, model=MODEL_NAME, latency_ms=latency_ms)


if __name__ == "__main__":
    # 本地直接运行入口
    uvicorn.run(app, host="0.0.0.0", port=8001)
