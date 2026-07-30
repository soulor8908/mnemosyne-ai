// 嵌入生成：双模式（本地 transformers.js + 云端 Workers AI）
import type { EmbeddingModel, EmbeddingMode } from '@/types';
import { getOrCreateUserPrefs } from '@/lib/auth/user-prefs';
import type { Env } from '@/lib/auth/session';

let _localEmbedder: any = null;

async function getLocalEmbedder() {
  if (!_localEmbedder) {
    // 本地打包的 transformers.js（依赖已在 package.json 声明，构建期打入浏览器 bundle）
    // 不再从 CDN 运行时加载——让"隐私模式"名副其实：推理代码不依赖任何外部网络。
    // 模型权重 Xenova/all-MiniLM-L6-v2 首次仍由 transformers.js 从 HuggingFace 下载，
    // 并缓存进浏览器 Cache API；缓存后即可完全离线推理。
    // 注意：next.config.mjs 已将 @xenova/transformers（及 onnxruntime-node）标记为
    // server external，确保服务端 bundle 不打包原生模块。
    const mod = await import('@xenova/transformers');
    _localEmbedder = await mod.pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
  }
  return _localEmbedder;
}

export interface EmbedResult {
  vector: number[];
  model: EmbeddingModel;
  mode: EmbeddingMode;
  dim: number;
}

export async function embed(
  text: string,
  mode: EmbeddingMode,
  env?: Env
): Promise<EmbedResult> {
  if (mode === 'local') {
    return embedLocal(text);
  }
  if (!env) throw new Error('cloud embed 需要 env');
  return embedCloud(text, env);
}

export async function embedLocal(text: string): Promise<EmbedResult> {
  const embedder = await getLocalEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data as Float32Array);
  return { vector, model: 'local-mini', mode: 'local', dim: 384 };
}

export async function embedCloud(text: string, env: Env): Promise<EmbedResult> {
  // 截断避免超限（bge-base 最大 512 token）
  const truncated = text.slice(0, 2000);
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [truncated],
  });
  const data = (result as { data: number[][] }).data;
  return {
    vector: data[0],
    model: 'bge-base-en-v1.5',
    mode: 'cloud',
    dim: 768,
  };
}

// 决定嵌入模式（基于用户偏好）
export async function resolveEmbedMode(): Promise<EmbeddingMode> {
  const prefs = await getOrCreateUserPrefs();
  return prefs.privacyMode ? 'local' : 'cloud';
}

// 为笔记生成嵌入（带缓存）
export async function embedNote(
  noteId: string,
  content: string,
  env?: Env
): Promise<void> {
  const { ensureEmbedding } = await import('@/lib/db/embeddings');
  const mode = await resolveEmbedMode();
  await ensureEmbedding(noteId, content, async (text) => {
    return embed(text, mode, env);
  });
}
