// 多 provider 路由（复用 devpath-ai 思路）
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { Env } from '@/lib/auth/session';

export type Provider = 'deepseek' | 'glm' | 'openai' | 'workers-ai';
export type TaskType =
  | 'embed'
  | 'chat'
  | 'summary'
  | 'tags'
  | 'title'
  | 'agent'
  | 'writing';

const PROVIDER_BASE_URL: Record<Provider, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  openai: 'https://api.openai.com/v1',
  'workers-ai': '', // 不走 OpenAI 兼容
};

const PROVIDER_MODEL: Record<Provider, string> = {
  deepseek: 'deepseek-chat',
  glm: 'glm-4-flash',
  openai: 'gpt-4o-mini',
  'workers-ai': '',
};

export async function resolveProvider(
  task: TaskType,
  byokKeys: Record<string, string> | undefined,
  env: Env
): Promise<{ provider: Provider; apiKey: string | null }> {
  // 优先用 BYOK
  if (byokKeys?.deepseek) return { provider: 'deepseek', apiKey: byokKeys.deepseek };
  if (byokKeys?.openai) return { provider: 'openai', apiKey: byokKeys.openai };
  if (byokKeys?.glm) return { provider: 'glm', apiKey: byokKeys.glm };

  // Trial 模式（用平台密钥）
  if (env.DEEPSEEK_API_KEY) return { provider: 'deepseek', apiKey: env.DEEPSEEK_API_KEY };
  if (env.GLM_API_KEY) return { provider: 'glm', apiKey: env.GLM_API_KEY };

  // 兜底：Workers AI
  return { provider: 'workers-ai', apiKey: null };
}

export function createModel(provider: Provider, apiKey: string): LanguageModel {
  if (provider === 'workers-ai') {
    throw new Error('Workers AI 不走 OpenAI 兼容接口，请用 env.AI.run');
  }
  const openai = createOpenAI({
    apiKey,
    baseURL: PROVIDER_BASE_URL[provider],
  });
  return openai(PROVIDER_MODEL[provider]);
}

export async function callLLM(
  task: TaskType,
  prompt: string,
  opts: {
    byokKeys?: Record<string, string>;
    env: Env;
    system?: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  const { provider, apiKey } = await resolveProvider(task, opts.byokKeys, opts.env);

  if (provider === 'workers-ai' || !apiKey) {
    // Workers AI 兜底（用 Llama 模型）
    const result = await opts.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        { role: 'user' as const, content: prompt },
      ],
      max_tokens: opts.maxTokens ?? 1024,
    });
    return (result as { response: string }).response ?? '';
  }

  const model = createModel(provider, apiKey);
  const { generateText } = await import('ai');
  const result = await generateText({
    model,
    prompt,
    system: opts.system,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  });
  return result.text;
}
