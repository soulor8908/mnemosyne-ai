import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // OpenNext 需要 standalone 输出（否则 opennextjs-cloudflare build 找不到 pages-manifest.json）
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
    // 优化打包：把第三方重依赖按文件级拆分，避免 barrel import 把整个包并进首屏 bundle。
    optimizePackageImports: [
      'date-fns',
      'react-markdown',
      'remark-gfm',
      'rehype-highlight',
      'ts-fsrs',
      'dexie',
      'dexie-react-hooks',
      'zod',
      'yaml',
      '@modelcontextprotocol/sdk',
    ],
  },
  // @xenova/transformers（及其可选原生依赖）只在浏览器端运行本地 embedding，
  // 服务端（Cloudflare Worker）永远不会执行它们。若不排除，Next 的输出文件
  // 追踪会把 onnxruntime-node/sharp 的 .node 原生二进制复制进 server 产物，
  // 导致 OpenNext 的 esbuild 打包阶段报 "No loader for .node" 而无法部署。
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@xenova/transformers/**',
      'node_modules/onnxruntime-node/**',
      'node_modules/sharp/**',
    ],
  },
  // @xenova/transformers 在 Next 默认的 server 外部包清单里（server-external-packages.json），
  // 默认会在 server chunk 中保留字面 import()——OpenNext 的 esbuild 二次打包时会顺着它
  // 解析到 onnxruntime-node/sharp 的 .node 原生二进制而失败。
  // 用 transpilePackages 把它拉回 webpack 打包流程，配合下方 server 端 alias=false 彻底剔除。
  transpilePackages: ['@xenova/transformers'],
  // Cloudflare Workers 需要：服务端彻底剔除只在浏览器端用的模块。
  // 服务端 embed 走 Workers AI（embedCloud），
  // 本地推理（embedLocal → @xenova/transformers）只会在浏览器端触发。
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@xenova/transformers': false,
        'onnxruntime-node': false,
        sharp: false,
      };
    }

    // 客户端：把"按需异步加载"的重依赖强制拆成独立 chunk，避免被默认打包策略
    // 合并进首屏 shared chunk。Next 15 的 splitChunks 默认对 node_modules 走 vendors
    // 组，但大于一定体积的依赖仍可能进 shared chunk。这里用 cacheGroups 显式拆分，
    // chunks:'async' 表示只在动态 import 时生效，不会改变静态 import 的行为。
    if (!isServer) {
      config.optimization = config.optimization || {};
      config.optimization.splitChunks = config.optimization.splitChunks || {};
      const existing = config.optimization.splitChunks;
      const cacheGroups =
        typeof existing === 'object' && !Array.isArray(existing)
          ? { ...(existing.cacheGroups || {}) }
          : {};

      // @xenova/transformers（含 onnxruntime-web）≈ 500KB，仅在隐私模式本地嵌入时需要
      cacheGroups.xenova = {
        test: /[\\/]node_modules[\\/]@xenova[\\/]/,
        name: 'xenova-transformers',
        chunks: 'async',
        priority: 30,
      };
      // markdown 渲染栈（react-markdown + remark-gfm + micromark + unified 等）≈ 140KB
      cacheGroups.markdown = {
        test: /[\\/]node_modules[\\/](react-markdown|remark-[^\\/]+|rehype-[^\\/]+|unified|micromark[^\\/]*|mdast[^\\/]*|hast[^\\/]*|vfile|unist[^\\/]*)[\\/]/,
        name: 'markdown-stack',
        chunks: 'async',
        priority: 25,
      };
      // yaml 解析器（仅飞书 inbox 解析用到）≈ 94KB
      cacheGroups.yaml = {
        test: /[\\/]node_modules[\\/]yaml[\\/]/,
        name: 'yaml-parser',
        chunks: 'async',
        priority: 25,
      };
      // ts-fsrs 间隔重复算法 ≈ 19KB
      cacheGroups.fsrs = {
        test: /[\\/]node_modules[\\/]ts-fsrs[\\/]/,
        name: 'ts-fsrs',
        chunks: 'async',
        priority: 20,
      };

      existing.cacheGroups = cacheGroups;
    }

    return config;
  },
};

export default withBundleAnalyzer(nextConfig);
