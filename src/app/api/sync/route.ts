// 同步 API：上传本地 delta + 拉取远程 delta
import { NextRequest, NextResponse } from 'next/server';
import { SyncRequestSchema } from '@/lib/ai/schemas';
import { getEnv } from '@/lib/auth/session';


export async function POST(req: NextRequest) {
  try {
    const env = getEnv();
    const body = await req.json();
    const parsed = SyncRequestSchema.parse(body);

    // 在 edge runtime 中无法直接访问 Dexie（IndexedDB 是浏览器 API）
    // 同步逻辑在客户端调用 sync/engine.ts，这里只返回远程状态
    // 客户端用 fetch 拿到 delta 列表后在浏览器合并

    const userId = 'local'; // MVP 阶段单用户，后续扩展多用户

    // 列出远程 delta
    const list = await env.NOTES_DELTA.list({
      prefix: `u:${userId}:delta:`,
    });

    return NextResponse.json({
      ok: true,
      remoteKeys: list.keys,
      sinceRev: parsed.sinceRev ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'sync failed' },
      { status: 500 }
    );
  }
}

// 获取单个 delta 内容
export async function GET(req: NextRequest) {
  try {
    const env = getEnv();
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'missing key' }, { status: 400 });
    }
    const value = await env.NOTES_DELTA.get(key);
    if (!value) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ value });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 500 }
    );
  }
}

// 上传单条 delta
export async function PUT(req: NextRequest) {
  try {
    const env = getEnv();
    const body = await req.json();
    const { key, value, ttl } = body as { key: string; value: string; ttl?: number };

    if (!key || !value) {
      return NextResponse.json({ error: 'missing key or value' }, { status: 400 });
    }

    const userId = 'local';
    // 安全：key 必须以用户前缀开头
    const fullKey = key.startsWith(`u:${userId}:`) ? key : `u:${userId}:${key}`;

    await env.NOTES_DELTA.put(fullKey, value, ttl ? { expirationTtl: ttl } : undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'upload failed' },
      { status: 500 }
    );
  }
}
