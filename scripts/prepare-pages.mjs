// OpenNext 产物 → Cloudflare Pages 适配脚本
//
// 背景：国内无法稳定访问 workers.dev，但 pages.dev 可正常访问。
// OpenNext 官方只支持部署到 Workers，但 Pages 的 advanced mode（_worker.js）
// 可以接受同样的 Module Worker，因此把 OpenNext 产物「包装」一下即可部署到 Pages，
// 拿到 *.pages.dev 域名，解决国内访问问题。
//
// 做了什么：
//   1. 复制 worker.js → _worker.js（Pages advanced mode 的入口约定）
//   2. 清理 server bundle 里的 onnxruntime-node 原生二进制（避免上传 .node 失败）
//   3. 把 assets/ 内容平铺到 .open-next/ 根
//      （Pages 把输出目录当作静态资源根；Workers 模式下 assets/ 是独立 binding，
//       路径映射不同。平铺后 URL 路径才能与 Next.js 期望的 /_next/static/* 对齐）
//   4. 生成 _routes.json：让 /_next/static/* 等纯静态资源绕过 Worker，直接走 CDN
//      （省 Pages Functions 调用次数，且静态资源请求在 Pages 免费且无限）
//
// 用法：
//   npm run build:pages          # opennextjs-cloudflare build && node scripts/prepare-pages.mjs
//   npm run deploy:pages         # 上面 + wrangler pages deploy
import { existsSync, copyFileSync, rmSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const OPEN_NEXT_DIR = resolve(ROOT, '.open-next');

// 1. 检查 .open-next 是否存在
if (!existsSync(OPEN_NEXT_DIR)) {
  console.error('[prepare-pages] 未找到 .open-next/ 目录，请先运行 opennextjs-cloudflare build。');
  process.exit(1);
}

// 2. 复制 worker.js → _worker.js
const workerSrc = join(OPEN_NEXT_DIR, 'worker.js');
const workerDest = join(OPEN_NEXT_DIR, '_worker.js');
if (!existsSync(workerSrc)) {
  console.error('[prepare-pages] 未找到 .open-next/worker.js，OpenNext 构建可能失败。');
  process.exit(1);
}
copyFileSync(workerSrc, workerDest);
console.log('[prepare-pages] ✅ 复制 worker.js → _worker.js');

// 3. 清理 server bundle 里的 onnxruntime-node（与原 predeploy 脚本逻辑一致）
//    @xenova/transformers 只在浏览器端运行，服务端若携带 onnxruntime-node 的 .node
//    原生二进制，Pages 上传阶段会报错。
const onnxDir = join(OPEN_NEXT_DIR, 'server-functions', 'default', 'node_modules', 'onnxruntime-node');
if (existsSync(onnxDir)) {
  rmSync(onnxDir, { recursive: true, force: true });
  console.log('[prepare-pages] ✅ 清理 onnxruntime-node');
}

// 4. 把 assets/ 内容平铺到 .open-next/ 根
const assetsDir = join(OPEN_NEXT_DIR, 'assets');
if (existsSync(assetsDir)) {
  copyDirSync(assetsDir, OPEN_NEXT_DIR);
  console.log('[prepare-pages] ✅ 平铺 assets/ 到 .open-next/ 根');
} else {
  console.warn('[prepare-pages] ⚠️ 未找到 assets/ 目录，静态资源可能缺失');
}

// 5. 生成 _routes.json
//    exclude 的路径会直接由 Pages 静态资源服务返回，不触发 _worker.js。
//    只排除确定存在的纯静态资源路径，避免 exclude 后文件不存在导致 404。
const routes = {
  version: 1,
  include: ['/*'],
  exclude: [
    '/_next/static/*',
    '/manifest.json',
  ],
};
writeFileSync(join(OPEN_NEXT_DIR, '_routes.json'), JSON.stringify(routes, null, 2) + '\n');
console.log('[prepare-pages] ✅ 生成 _routes.json（静态资源绕过 Worker）');

console.log('[prepare-pages] 🎉 Pages 产物准备完成，可用 `wrangler pages deploy .open-next` 部署');

// ── 辅助：递归复制目录 ─────────────────────────────────────
function copyDirSync(src, dest) {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath);
    } else {
      // 跳过已存在的 _worker.js / worker.js，避免覆盖
      if (entry.name === '_worker.js' || entry.name === 'worker.js') continue;
      copyFileSync(srcPath, destPath);
    }
  }
}
