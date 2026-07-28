// 嵌入生成 API（云端 Workers AI）
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getEnv } from '@/lib/auth/session';


const EmbedSchema = z.object({
  text: z.string().min(1).max(5000),
});

export async function POST(req: NextRequest) {
  try {
    const env = getEnv();
    const body = await req.json();
    const { text } = EmbedSchema.parse(body);

    const truncated = text.slice(0, 2000);
    const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [truncated],
    });
    const data = (result as { data: number[][] }).data;

    return NextResponse.json({
      vector: data[0],
      model: 'bge-base-en-v1.5',
      dim: 768,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'embed failed' },
      { status: 500 }
    );
  }
}
