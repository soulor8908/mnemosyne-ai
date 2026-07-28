/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  // Cloudflare Workers 需要：把只在浏览器端用的原生模块标记为 external
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      // @xenova/transformers 只在浏览器端运行（本地嵌入），服务端不应打包
      config.externals.push({
        '@xenova/transformers': 'commonjs @xenova/transformers',
        'onnxruntime-node': 'commonjs onnxruntime-node',
      });
      // 避免 esbuild 报 .node 文件错误
      config.module.rules.push({
        test: /\.node$/,
        use: 'ignore-loader',
      });
    }
    return config;
  },
};

export default nextConfig;
