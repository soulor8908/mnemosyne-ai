// 同步 API：上传本地 delta + 拉取远程 delta
// 多用户：userId 取自零信任会话（resolveAuth），所有 KV 读写按 userId 隔离，
// 并强制校验请求中的 key 归属，杜绝跨用户读写。
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SyncRequestSchema } from '@/lib/ai/schemas';
import { getEnv } from '@/lib/auth/session';
import { resolveAuth } from '@/lib/auth/guard';
import { verifyNonce } from '@/lib/auth/session';

// key 形状：u:{userId}:delta:{noteId}:{rev}，userId/noteId 用 URL-safe 字符
const SYNC_KEY_RE = /^u:[A-Za-z0-9_-]+:delta:[A-Za-z0-9_-]+:[0-9]+$/;

const PutBodySchema = z.object({
  key: z.string().regex(SYNC_KEY_RE, 'key must match u:{userId}:delta:{noteId}:{rev}'),
  value: z.string().min(1),
  ttl: z.number().int().positive().optional(),
  // 可选 nonce：防重放（客户端同步时应携带唯一 nonce）
  nonce: z.string().min(8).max(128).optional(),
});

/** 从 delta key 解析 userId 段 */
function userIdOfKey(key: string): string {
  return key.split(':')[1] ?? '';
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveAuth(req);
    if (auth.err) return auth.err;
    const env = getEnv();
    const body = await req.json();
    const parsed = SyncRequestSchema.parse(body);

    // 只列出当前用户前缀下的 delta
    const list = await env.NOTES_DELTA.list({
      prefix: `u:${auth.userId}:delta:`,
    });

    return NextResponse.json({
      ok: true,
      remoteKeys: list.keys,
      sinceRev: parsed.sinceRev ?? 0,
    });
  } catch (err) {
    const status = err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'sync failed' },
      { status }
    );
  }
}

// 获取单个 delta 内容
export async function GET(req: NextRequest) {
  try {
    const auth = await resolveAuth(req);
    if (auth.err) return auth.err;
    const env = getEnv();
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'missing key' }, { status: 400 });
    }
    if (!SYNC_KEY_RE.test(key)) {
      return NextResponse.json({ error: 'invalid key format' }, { status: 400 });
    }
    // 归属校验：只能读自己的数据
    if (userIdOfKey(key) !== auth.userId) {
      return NextResponse.json({ error: '无权读取其他用户的数据' }, { status: 403 });
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
    const auth = await resolveAuth(req);
    if (auth.err) return auth.err;
    const env = getEnv();
    const body = await req.json();
    const parsed = PutBodySchema.parse(body);

    // 归属校验：只能写自己的数据
    if (userIdOfKey(parsed.key) !== auth.userId) {
      return NextResponse.json({ error: '无权写入其他用户的数据' }, { status: 403 });
    }

    // 可选 nonce 防重放
    if (parsed.nonce) {
      const ok = await verifyNonce(auth.userId, parsed.nonce);
      if (!ok) {
        return NextResponse.json({ error: '检测到重复请求（nonce 已使用）' }, { status: 409 });
      }
    }

    await env.NOTES_DELTA.put(
      parsed.key,
      parsed.value,
      parsed.ttl ? { expirationTtl: parsed.ttl } : undefined
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'upload failed' },
      { status }
    );
  }
}
