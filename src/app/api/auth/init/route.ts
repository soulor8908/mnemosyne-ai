// 初始化/恢复 MASTER_KEY
import { NextRequest, NextResponse } from 'next/server';
import { MasterKeyInitSchema } from '@/lib/ai/schemas';


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    MasterKeyInitSchema.parse(body);

    // 在服务端我们只校验格式，真正的 master key 只存在客户端
    // 这里返回一个 session 标识（实际部署中可结合 KV）
    return NextResponse.json({
      ok: true,
      message: 'master key 已在客户端初始化',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid request' },
      { status: 400 }
    );
  }
}
