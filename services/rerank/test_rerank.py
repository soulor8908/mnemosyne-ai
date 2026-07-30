"""rerank 服务 API 契约测试.

注意：测试里不真正加载大模型（太慢），用 monkeypatch 把 get_model 替换成 mock，
mock 按 query 在 doc 中出现次数打分，只验证 API 契约。
"""

from __future__ import annotations

from typing import List

import pytest
from fastapi.testclient import TestClient


class MockCrossEncoder:
    """Mock Cross-Encoder：按 query 在 doc 中出现次数打分.

    仅用于测试，避免下载/加载真实模型。
    """

    def predict(self, pairs: List[List[str]]) -> List[float]:
        scores: List[float] = []
        for query, doc in pairs:
            # 统计 query 在 doc 中出现次数作为相关性分数
            count: int = doc.count(query)
            scores.append(float(count))
        return scores


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """构造一个已注入 mock 模型的 TestClient.

    在 TestClient 创建前 patch get_model，避免启动事件触发真实模型加载。
    """
    # 在模块加载真实模型前替换 get_model
    import app

    monkeypatch.setattr(app, "get_model", lambda: MockCrossEncoder())

    # 进入上下文会触发 startup 事件，此时 get_model 已被替换
    with TestClient(app.app) as c:
        yield c


def test_health(client: TestClient) -> None:
    """健康检查应返回 ok 与模型名."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["model"] == "BAAI/bge-reranker-v2-m3"


def test_rerank_basic(client: TestClient) -> None:
    """重排基本功能：最相关文档应排第一，且结果数 <= top_n."""
    payload = {
        "query": "机器学习",
        "documents": [
            "深度学习是机器学习分支",
            "今天天气不错",
            "神经网络训练",
        ],
        "top_n": 2,
    }
    resp = client.post("/rerank", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    # 结果数不应超过 top_n
    assert len(data["results"]) <= payload["top_n"]
    # 模型字段应回填
    assert data["model"] == "BAAI/bge-reranker-v2-m3"
    # 延迟应为非负整数
    assert isinstance(data["latency_ms"], int)
    assert data["latency_ms"] >= 0

    # 第一条应对应最相关文档（query 在第 0 条出现）
    assert data["results"][0]["index"] == 0
    assert data["results"][0]["score"] > 0


def test_rerank_top_n_default(client: TestClient) -> None:
    """未指定 top_n 时默认返回不超过 5 条."""
    payload = {
        "query": "机器学习",
        "documents": [
            "深度学习是机器学习分支",
            "今天天气不错",
            "神经网络训练",
            "机器学习很有用",
            "机器学习是机器学习",
            "无关文档",
        ],
    }
    resp = client.post("/rerank", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) <= 5


def test_rerank_empty_documents(client: TestClient) -> None:
    """空候选文档列表应返回空结果."""
    payload = {
        "query": "机器学习",
        "documents": [],
        "top_n": 5,
    }
    resp = client.post("/rerank", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["results"] == []


def test_rerank_results_sorted_desc(client: TestClient) -> None:
    """结果应按分数降序排列."""
    payload = {
        "query": "机器学习",
        "documents": [
            "无关文档",  # 0 分
            "机器学习是机器学习",  # 2 分
            "深度学习是机器学习分支",  # 1 分
        ],
        "top_n": 3,
    }
    resp = client.post("/rerank", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    scores = [item["score"] for item in data["results"]]
    assert scores == sorted(scores, reverse=True)
