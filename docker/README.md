# Mnemosyne 自托管（Docker Compose）

本目录的方案让你在自己的机器 / VPS / 内网里跑一份完整的 Mnemosyne，无需依赖 Cloudflare 账号。

## 1. 为什么自托管

Mnemosyne 是 local-first 架构：笔记的明文真理之源始终在浏览器（IndexedDB），云端只保存端到端加密后的密文备份。自托管并不破坏这一模型，只是把"密文备份与服务端编排"从 Cloudflare Workers 搬到你自己的进程里。它带来的好处是：

- **数据主权**：所有密文、会话、审计日志都在你自己的机器上，不经过任何第三方 PaaS。
- **离线可用**：内网 / 断网环境也能用。AI 嵌入走浏览器本地推理（384 维），重排走本地 Python 服务，只有 LLM 问答仍需外网。
- **合规与审计**：金融、医疗、政企等不能把数据出域的场景，自托管是唯一选项。
- **学习与二次开发**：完整服务栈都在本地，方便魔改和定位问题。

## 2. 前置条件

- **Docker** ≥ 20.10
- **Docker Compose** v2（即 `docker compose` 或 `docker-compose` ≥ 1.29）
- 约 **2 GB** 可用内存（rerank 首次加载 sentence-transformers 模型较吃内存）
- 联网首次构建时需要拉取 node:18-alpine、redis:7-alpine、python:3.11-slim 以及 npm/pip 依赖

## 3. 快速启动

```bash
cp .env.example .env          # 编辑 .env，至少填入 SYNC_TOKEN
docker-compose up -d          # 三个服务一起起
docker-compose logs -f mnemosyne-web
```

打开 `http://localhost:3000`：

1. 进入「设置」完成 12 词助记词初始化（这是主密钥的唯一来源，请抄写保存）。
2. 选择「用助记词登录」（零信任多用户）或填入与 `SYNC_TOKEN` 相同的值（单用户兼容模式）。
3. 在「AI 配置」填入自己的 API Key（BYOK，加密存储在本地）。

停服：

```bash
docker-compose down           # 保留数据卷
docker-compose down -v        # 连同 redis 数据一起清空（慎用）
```

## 4. 服务拓扑

```
                        ┌──────────────────────────┐
                        │       用户浏览器          │
                        │  Dexie/IndexedDB（明文）  │
                        │  本地嵌入（384 维）       │
                        └────────────┬─────────────┘
                                     │ HTTPS / 同步密文 / API
                                     ▼
                        ┌──────────────────────────┐
                        │   mnemosyne-web :3000    │
                        │   (Next.js standalone)   │
                        └──┬───────────────────┬───┘
                           │                   │
                  会话/challenge/审计      重排（Cross-Encoder）
                           │                   │
                           ▼                   ▼
              ┌────────────────────┐  ┌────────────────────┐
              │   redis :6379      │  │   rerank :8001     │
              │   redis:7-alpine   │  │   python:3.11-slim │
              │   AOF + Volume     │  │   HF 缓存 Volume   │
              └────────────────────┘  └────────────────────┘
```

## 5. 环境变量说明

所有变量在 `.env.example` 中有注释。关键项：

| 变量 | 必填 | 说明 |
|---|---|---|
| `SYNC_TOKEN` | 是 | API / 同步通道访问令牌。零信任多用户模式下仅为兼容遗留共享访问。 |
| `REDIS_URL` | 是 | Redis 连接串，替代 Cloudflare KV 存放会话 / challenge / 审计日志。容器内固定为 `redis://redis:6379`。 |
| `RERANK_URL` | 是 | Cross-Encoder 重排服务地址。容器内固定为 `http://rerank:8001`。 |
| `OPENAI_API_KEY` | 否 | BYOK，按需填写。 |
| `DEEPSEEK_API_KEY` | 否 | BYOK，默认 provider。 |
| `GLM_API_KEY` | 否 | BYOK。 |
| `AI_PROVIDER` | 否 | `openai` / `deepseek` / `glm`，默认 `deepseek`。 |
| `EMBEDDING_MODE` | 是 | `local`（384 维，浏览器内推理）或 `cloud`（768 维，Workers AI）。**自托管必须为 `local`**。 |
| `APP_URL` | 否 | 应用对外 URL，默认 `http://localhost:3000`。 |

> `MASTER_KEY` 不在 `.env` 中。它由浏览器端 BIP39 助记词派生，仅存用户设备内存。详见 `docs/TECHNICAL_DESIGN.md`。

## 6. 与 Cloudflare 部署的差异

| 维度 | Cloudflare 部署 | Docker 自托管 |
|---|---|---|
| 运行时 | Workers（nodejs_compat） | Node 18 进程 |
| 会话 / KV | Cloudflare KV（多 namespace） | Redis 7（AOF 持久化到 docker volume） |
| 嵌入模型 | Workers AI `bge-base-en-v1.5`（768 维） | 浏览器内 `@xenova/transformers`（384 维） |
| 重排服务 | 同一 Worker 内调用 | 独立 `rerank` 容器（FastAPI + sentence-transformers） |
| 大附件 | R2 bucket（可选） | 暂不支持，需自行扩展 |
| Cron / 夜间 Agent | Cron Trigger | 未启用（需自行接 cron 调 `/api/agent`） |
| 域名 / TLS | workers.dev 自带 | 自行反代（nginx / Caddy） |

### ⚠️ 嵌入维度变化的影响

`EMBEDDING_MODE=local` 时向量是 **384 维**，与 Cloudflare 部署的 768 维不兼容。已存在 768 维向量的浏览器库若切换部署，需要清空本地向量索引重建（应用内「设置 → 重建索引」）。两种部署模式下同一笔记的向量不可互导。

## 7. 构建前提：`output: 'standalone'`

主应用 Dockerfile 依赖 Next.js 的 standalone 产物（`.next/standalone/server.js`）。当前仓库的 `next.config.mjs` **没有开启** `output: 'standalone'`（因为它服务于 Cloudflare 的 OpenNext 打包链路）。

自托管部署前，请手动在 `next.config.mjs` 中加上：

```js
const nextConfig = {
  output: 'standalone',
  // ...其他既有配置保持不变
};
```

本仓库**不**在镜像里自动改写 `next.config.mjs`，避免影响 Cloudflare 部署链路。这一改动是可逆的，提交与否取决于你的主要部署目标。

## 8. 运维注意事项

- **首次构建慢**：rerank 服务会从 HuggingFace 拉 Cross-Encoder 模型（约 80–120 MB），已用 `rerank-hf-cache` 卷缓存。
- **Redis 持久化**：开启 AOF（`appendonly yes`），数据落到 `redis-data` 卷。`docker-compose down` 不会清空，`-v` 才会。
- **内存调优**：Redis 默认上限 256 MB + LRU，单用户足够；多用户共享部署请按需上调 `--maxmemory`。
- **TLS / 域名**：容器只暴露 HTTP。生产使用请在前面加 nginx / Caddy 反代并签发证书。
- **Workers AI 不可用**：自托管模式下 `EMBEDDING_MODE` 只能是 `local`；MCP 服务器的 `mnemosyne_embed_text` 也会走本地 384 维路径。
- **日志**：`docker-compose logs -f` 跟随；审计日志在 Redis 中按 key 前缀存放，可按需导出。

## 9. 常见问题

**Q：`docker-compose up` 后 mnemosyne-web 起不来，日志报 `.next/standalone` 不存在？**
A：没开 `output: 'standalone'`。见第 7 节，在 `next.config.mjs` 加上后重新 `docker-compose build`。

**Q：rerank 容器首次启动很慢甚至超时？**
A：在拉模型。可预先 `docker run --rm mnemosyne-rerank:local python -c "from sentence_transformers import CrossEncoder; CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"`，或挂代理后重建。

**Q：能直接用已有的外部 Redis 吗？**
A：可以。注释掉 `redis` 服务，把 `mnemosyne-web` 的 `REDIS_URL` 指到外部实例即可，但要保证网络可达且数据库实例隔离。
