/** @type {import('next').NextConfig} */
const nextConfig = {
  // OpenNext 需要 standalone 输出（否则 opennextjs-cloudflare build 找不到 pages-manifest.json）
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
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
    return config;
  },
};

export default nextConfig;
