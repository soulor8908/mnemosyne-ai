// 搜索 API（基于笔记内容的语义+关键词检索）
// 注意：检索主要在客户端完成（访问 IndexedDB），此 API 用于触发嵌入生成
import { NextRequest, NextResponse } from 'next/server';
import { SearchRequestSchema } from '@/lib/ai/schemas';
import { getEnv } from '@/lib/auth/session';


export async function POST(req: NextRequest) {
  try {
    const env = getEnv();
    const body = await req.json();
    const { query } = SearchRequestSchema.parse(body);

    // 生成查询向量（用于客户端语义检索）
    const truncated = query.slice(0, 2000);
    const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [truncated],
    });
    const data = (result as { data: number[][] }).data;

    return NextResponse.json({
      queryVector: data[0],
      model: 'bge-base-en-v1.5',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'search failed' },
      { status: 500 }
    );
  }
}
