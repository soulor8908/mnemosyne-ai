// 同步 API：上传本地 delta + 拉取远程 delta
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SyncRequestSchema } from '@/lib/ai/schemas';
import { getEnv } from '@/lib/auth/session';
import { requireAuth } from '@/lib/auth/guard';

// MVP 阶段单用户，后续扩展多用户时改为从 session 解析
const USER_ID = 'local';

// 严格的 key 校验：仅允许 `u:{userId}:delta:{noteId}:{rev}` 格式
// 修复要点：旧实现 `key.startsWith('u:local:') ? key : 'u:local:' + key`
// 完全无法阻止 `u:local:evil:arbitrary` 之类的 key 注入；匿名客户端可写任意 KV。
// noteId 用 nanoid（URL-safe），rev 是正整数。
const SYNC_KEY_RE = /^u:local:delta:[A-Za-z0-9_-]+:[0-9]+$/;

// GET 端点也只允许读 delta key（绝不开放任意 key 读取）
const SYNC_GET_KEY_RE = /^u:local:delta:[A-Za-z0-9_-]+:[0-9]+$/;

const PutBodySchema = z.object({
  key: z.string().regex(SYNC_KEY_RE, 'key must match u:local:delta:{noteId}:{rev}'),
  value: z.string().min(1),
  ttl: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAuth(req);
    if (denied) return denied;
    const env = getEnv();
    const body = await req.json();
    const parsed = SyncRequestSchema.parse(body);

    // 在 edge runtime 中无法直接访问 Dexie（IndexedDB 是浏览器 API）
    // 同步逻辑在客户端调用 sync/engine.ts，这里只返回远程状态
    // 客户端用 fetch 拿到 delta 列表后在浏览器合并

    // 列出远程 delta
    const list = await env.NOTES_DELTA.list({
      prefix: `u:${USER_ID}:delta:`,
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
    const denied = await requireAuth(req);
    if (denied) return denied;
    const env = getEnv();
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'missing key' }, { status: 400 });
    }
    // 严格校验 key 形状，防止任意 key 读取
    if (!SYNC_GET_KEY_RE.test(key)) {
      return NextResponse.json(
        { error: 'invalid key format' },
        { status: 400 }
      );
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
    const denied = await requireAuth(req);
    if (denied) return denied;
    const env = getEnv();
    const body = await req.json();
    // zod 严格校验：key 形状 + value 非空 + ttl（可选）
    const parsed = PutBodySchema.parse(body);

    await env.NOTES_DELTA.put(
      parsed.key,
      parsed.value,
      parsed.ttl ? { expirationTtl: parsed.ttl } : undefined
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    // zod 校验失败返回 400 而不是 500，便于客户端区分
    const status = err instanceof z.ZodError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'upload failed' },
      { status }
    );
  }
}
