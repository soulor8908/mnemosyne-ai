// AI 对话 API（流式）
import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getEnv } from '@/lib/auth/session';
import { requireAuth } from '@/lib/auth/guard';

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAuth(req);
    if (denied) return denied;
    const env = getEnv();
    const body = await req.json();
    const { messages, context, byokKey, provider } = body as {
      messages: Array<{ role: string; content: string }>;
      context?: string;
      byokKey?: string;
      provider?: 'deepseek' | 'glm' | 'openai';
    };

    // 决定 provider 与 apiKey
    let apiKey = byokKey;
    let baseURL = 'https://api.deepseek.com/v1';
    let modelName = 'deepseek-chat';

    if (!apiKey) {
      if (env.DEEPSEEK_API_KEY) {
        apiKey = env.DEEPSEEK_API_KEY;
      } else if (env.GLM_API_KEY) {
        apiKey = env.GLM_API_KEY;
        baseURL = 'https://open.bigmodel.cn/api/paas/v4';
        modelName = 'glm-4-flash';
      } else {
        return NextResponse.json(
          { error: '未配置 AI provider。请在设置中填入 API Key，或等待平台 Trial 启用。' },
          { status: 503 }
        );
      }
    } else {
      if (provider === 'glm') {
        baseURL = 'https://open.bigmodel.cn/api/paas/v4';
        modelName = 'glm-4-flash';
      } else if (provider === 'openai') {
        baseURL = 'https://api.openai.com/v1';
        modelName = 'gpt-4o-mini';
      }
    }

    const model = createOpenAI({ apiKey, baseURL })(modelName);

    const systemPrompt = `你是 Mnemosyne 的知识库助手。基于用户的笔记回答问题。

${context ? `用户笔记上下文：\n${context}\n` : ''}

原则：
1. 优先引用用户笔记内容
2. 如果笔记中没有相关信息，明确说明"你的笔记中没有相关内容"
3. 回答时标注引用来源（笔记标题）
4. 保持简洁，不啰嗦`;

    const result = await streamText({
      model,
      system: systemPrompt,
      messages: messages as any,
    });

    return result.toDataStreamResponse();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'chat failed' },
      { status: 500 }
    );
  }
}
