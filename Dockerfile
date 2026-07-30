# Mnemosyne 主应用镜像
# 多阶段构建：builder 阶段编译 Next.js，runner 阶段只携带运行时产物
#
# ⚠️ 前提：next.config.mjs 必须设置 `output: 'standalone'` 才能产出
#    `.next/standalone`（含 server.js）和 `.next/static`。
#    当前仓库 next.config.mjs 未开启此选项，请在自托管部署时手动加上：
#
#        const nextConfig = {
#          output: 'standalone',
#          // ...其他既有配置
#        };
#
#    本仓库不在镜像里强制改写 next.config（避免影响 Cloudflare 部署链路），
#    而是把前提写在 Dockerfile 与 docker/README.md 中由部署者确认。

# ───────────────────────── builder ─────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# 仅复制依赖描述，利用 docker 层缓存
COPY package.json package-lock.json* ./

RUN npm ci

# 复制源码并构建（standalone 产物会落到 .next/standalone）
COPY . .

RUN npm run build

# ───────────────────────── runner ──────────────────────────
FROM node:18-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
# Next.js standalone server 监听端口
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 非 root 运行更安全
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# 复制 standalone 产物（自带精简 node_modules）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 静态资源（_next/static、images 等）
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# 公共资源
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

# standalone 入口就是 server.js
CMD ["node", "server.js"]
