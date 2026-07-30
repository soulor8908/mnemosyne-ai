# Mnemosyne AI

> 让 AI 替你维护知识库，让你的思考永不丢失，并永远属于你自己。

一个 **local-first 的 AI 云笔记**（早期原型）。数据的真理之源在你的浏览器（IndexedDB），云端只保存端到端加密后的备份；AI 负责帮你检索、串联和复习知识，而不是替你写作。

**项目状态：个人原型（pre-alpha）。** 下表如实区分"已实现"与"仅在设计文档中"，避免夸大。

## 已实现 ✅

| 能力 | 说明 | 代码位置 |
|---|---|---|
| 本地笔记 | Dexie/IndexedDB 存储，版本化 schema 迁移，置顶/排序/附件 | `src/lib/db/` |
| 混合检索 | 关键词 + 语义向量 + RRF 融合 | `src/lib/ai/search.ts` |
| 端到端加密 | AES-GCM + PBKDF2（10 万次迭代），云端只见密文 | `src/lib/crypto/` |
| BIP39 助记词 | 12 词生成/校验（含 checksum）/派生主密钥，换设备恢复 | `src/lib/crypto/index.ts` |
| 云端同步 | 密文 delta 上传 Cloudflare KV，冲突时保快照标记 | `src/lib/sync/engine.ts` |
| API 鉴权 | 所有 `/api/*` 走 Bearer 令牌（`SYNC_TOKEN`），fail-closed | `src/lib/auth/guard.ts` |
| AI 问答 | 基于笔记上下文的流式对话（DeepSeek/GLM/OpenAI，BYOK 优先） | `src/app/api/chat/` |
| 间隔重复 | FSRS 算法复习卡 | `src/lib/fsrs/` |
| 导入导出 | Markdown / JSON / HTML 导入导出，数据无锁定 | `src/lib/markdown/export.ts` |
| 收集箱 | 飞书分享捕获 → inbox 导入 | `src/lib/inbox/` |
| 引用溯源 + 拒答 | 检索答案按来源编号 `[n]` 标注出处；无任何相关笔记时诚实拒答，绝不调用 LLM 编造 | `src/lib/ai/grounding.ts`、`src/app/recall/` |
| 网页剪藏 | 服务端抓取 URL 提取正文落库（绕开浏览器 CORS） | `src/app/api/capture/`、`src/app/capture/` |

## 设计中 / 未实现 📋

以下内容在 `docs/` 设计文档中有完整方案，但**代码尚未落地**：

- 夜间自动整理 Agent（Cron 触发）——目前 Agent 需在客户端手动触发，链接提议基于余弦相似度而非 LLM
- R2 大附件存储
- 多用户与真正的 session/nonce 零信任体系（当前为单用户共享令牌）

## 快速开始

```bash
npm install

# 本地开发：创建 .dev.vars（已 gitignore）写入 SYNC_TOKEN=<自定义令牌>
npm run dev
```

首次使用：打开 设置 → 「服务端访问令牌」填入与 `SYNC_TOKEN` 相同的值；如需 AI 能力，在「AI 配置」填入自己的 API Key（BYOK，加密存储）。

## 部署（Cloudflare Workers）

```bash
cp wrangler.toml.example wrangler.toml   # 填入你自己的 KV namespace id
wrangler secret put SYNC_TOKEN           # API 访问令牌（必需）
npm run deploy
```

## 安全模型（简要）

- **MASTER_KEY 永不离开客户端**：由 12 词 BIP39 助记词派生，仅存内存；服务端与 KV 只见密文。
- **助记词是唯一恢复手段**：请抄写保存。校验含 BIP39 checksum，错词/乱序会被明确拒绝。
- **SYNC_TOKEN 是访问令牌**，只控制谁能调用 API，与笔记加密无关。
- 历史提交曾泄漏 KV namespace id（非凭证，风险低）；介意者可重建 namespace，模板见 `wrangler.toml.example`。

## 技术栈

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind · Dexie · Cloudflare Workers/KV/Workers AI (@opennextjs/cloudflare) · Vercel AI SDK · ts-fsrs · zod

## 文档

- `docs/PRODUCT_DESIGN.md` — 产品定位、差异化与演进路径
- `docs/TECHNICAL_DESIGN.md` — 架构决策与安全设计

## 测试

```bash
npm test            # vitest 单元/集成测试
npm run typecheck   # TypeScript 检查
npm run quality-gate
```
