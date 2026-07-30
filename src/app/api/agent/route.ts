// Agent API：手动触发夜间整理
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/guard';

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAuth(req);
    if (denied) return denied;
    // 动态导入避免在 edge bundle 加载 Dexie
    // Agent 实际执行需要浏览器上下文（IndexedDB），这里返回"已调度"
    // 真正的 Agent 在客户端调用 lib/ai/agent/runner.ts 的 runAgent
    // 这个 API 主要用于 Cron 触发场景（多用户时）

    return NextResponse.json({
      ok: true,
      message: 'Agent 应在客户端触发（访问 IndexedDB）',
      hint: '调用 /api/agent/run 在浏览器端执行',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'agent failed' },
      { status: 500 }
    );
  }
}
