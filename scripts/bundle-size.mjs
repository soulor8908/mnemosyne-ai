// 打包体积监控脚本
// 目标：Cloudflare 国内访问慢，对初始包体积敏感。
// 策略：
//   1. 区分「首屏必加载」与「异步懒加载」chunk，重点卡首屏总大小。
//   2. 对命名的重型依赖 chunk（xenova / markdown / yaml / fsrs）单独设上限，
//      防止懒加载 chunk 反向膨胀。
//   3. 输出 JSON 报告 + 控制台表格，CI 失败时 exit 1。
//
// 用法：
//   node scripts/bundle-size.mjs                 # 检查 + 打印报告
//   node scripts/bundle-size.mjs --update        # 把当前体积写回 baseline（用于初始设定 / 主动放宽）
//   node scripts/bundle-size.mjs --bail          # 仅在超阈值时 exit 1（CI 用）
//
// 阈值配置：.bundlebudget.json（见仓库根目录）
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.cwd();
const NEXT_DIR = join(ROOT, '.next');
const CHUNKS_DIR = join(NEXT_DIR, 'static', 'chunks');
const CONFIG_PATH = join(ROOT, '.bundlebudget.json');
const REPORT_PATH = join(ROOT, '.next', 'bundle-report.json');

const args = new Set(process.argv.slice(2));
const UPDATE_MODE = args.has('--update');
const BAIL = args.has('--bail');

if (!existsSync(NEXT_DIR) || !existsSync(CHUNKS_DIR)) {
  console.error('[bundle-size] 未找到 .next/static/chunks，请先运行 `npm run build`。');
  process.exit(1);
}

// 读取阈值配置
let config;
if (existsSync(CONFIG_PATH)) {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} else {
  // 首次运行的兜底默认值
  config = {
    initialTotalBytes: 380 * 1024,
    lazyTotalBytes: 1200 * 1024,
    chunks: {
      'xenova-transformers': 260 * 1024,
      'markdown-stack': 150 * 1024,
      'yaml-parser': 130 * 1024,
      'ts-fsrs': 60 * 1024,
    },
  };
}

// 识别首屏必加载 chunk：来自 build-manifest 的 rootMainFiles + polyfillFiles
const manifest = JSON.parse(readFileSync(join(NEXT_DIR, 'build-manifest.json'), 'utf8'));
const initialSet = new Set([
  ...manifest.polyfillFiles.map((f) => basename(f)),
  ...manifest.rootMainFiles.map((f) => basename(f)),
]);

// 扫描所有 chunk 文件（递归 chunks/ 与 app/）
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const allFiles = walk(CHUNKS_DIR);

const configuredBuckets = new Set(Object.keys(config.chunks || {}));

function classify(file) {
  const name = basename(file);
  // 仅识别配置中显式声明阈值的命名 chunk（splitChunks name）。
  // Next.js 自动生成的 hash 命名 chunk（如 b2db8554.xxx.js）不在此列，
  // 会归入 lazy，避免污染命名 chunk 统计。
  const namedMatch = name.match(/^([a-z][a-z0-9-]+)\.[a-z0-9]+\.js$/i);
  if (namedMatch && configuredBuckets.has(namedMatch[1])) {
    return { kind: 'named', bucket: namedMatch[1], name };
  }
  if (initialSet.has(name)) return { kind: 'initial', bucket: 'initial', name };
  return { kind: 'lazy', bucket: 'lazy', name };
}

const records = [];
let initialTotal = 0;
let lazyTotal = 0;
const namedTotals = {};

for (const file of allFiles) {
  const size = statSync(file).size;
  const info = classify(file);
  records.push({ ...info, path: file, size });
  if (info.kind === 'initial') initialTotal += size;
  else lazyTotal += size;
  if (info.kind === 'named') {
    namedTotals[info.bucket] = (namedTotals[info.bucket] || 0) + size;
  }
}

// 评估
const violations = [];

function check(label, actual, limit) {
  const ok = actual <= limit;
  if (!ok) violations.push({ label, actual, limit });
  return ok;
}

check('initialTotal', initialTotal, config.initialTotalBytes);
check('lazyTotal', lazyTotal, config.lazyTotalBytes);
for (const [bucket, limit] of Object.entries(config.chunks || {})) {
  if (namedTotals[bucket] !== undefined) {
    check(`chunk:${bucket}`, namedTotals[bucket], limit);
  }
}

// 控制台报告
function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

console.log('\n========== Bundle Size Report ==========');
console.log(`首屏必加载 (initial):  ${fmt(initialTotal)} / ${fmt(config.initialTotalBytes)}`);
console.log(`异步懒加载 (lazy):     ${fmt(lazyTotal)} / ${fmt(config.lazyTotalBytes)}`);
console.log('\n命名 chunk 明细：');
const sortedNamed = Object.entries(namedTotals).sort((a, b) => b[1] - a[1]);
for (const [bucket, size] of sortedNamed) {
  const limit = config.chunks?.[bucket];
  const limitStr = limit ? ` / ${fmt(limit)}` : ' (无阈值)';
  console.log(`  ${bucket.padEnd(24)} ${fmt(size)}${limitStr}`);
}

console.log('\n首屏 Top 5 chunk：');
const initialTop = records
  .filter((r) => r.kind === 'initial')
  .sort((a, b) => b.size - a.size)
  .slice(0, 5);
for (const r of initialTop) {
  console.log(`  ${r.name.padEnd(40)} ${fmt(r.size)}`);
}

if (violations.length === 0) {
  console.log('\n✅ 所有阈值通过');
} else {
  console.log('\n❌ 超阈值项：');
  for (const v of violations) {
    const over = v.actual - v.limit;
    console.log(`  ${v.label.padEnd(24)} ${fmt(v.actual)} > ${fmt(v.limit)}  (超 ${fmt(over)})`);
  }
}

// 写入 JSON 报告（供 CI artifact 上传 / 趋势追踪）
const report = {
  timestamp: new Date().toISOString(),
  initialTotal,
  lazyTotal,
  namedTotals,
  limits: config,
  violations,
  records: records.map((r) => ({ name: r.name, bucket: r.bucket, kind: r.kind, size: r.size })),
};
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(`\n报告已写入: ${REPORT_PATH}`);

// --update: 把当前体积写回 baseline（允许 5% 容差上浮）
if (UPDATE_MODE) {
  const headroom = (bytes) => Math.ceil(bytes * 1.05);
  const newConfig = {
    initialTotalBytes: headroom(initialTotal),
    lazyTotalBytes: headroom(lazyTotal),
    chunks: {},
  };
  for (const [bucket, size] of Object.entries(namedTotals)) {
    newConfig.chunks[bucket] = headroom(size);
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2) + '\n');
  console.log(`\n📝 已更新阈值配置: ${CONFIG_PATH}`);
  console.log('   （当前体积 × 1.05 作为新基线，含 5% 容差）');
  process.exit(0);
}

if (BAIL && violations.length > 0) {
  console.error('\n🚫 Bundle size check failed — 见上方超阈值项。');
  console.error('   若为预期增长：`node scripts/bundle-size.mjs --update` 更新基线后提交。');
  process.exit(1);
}

process.exit(0);
