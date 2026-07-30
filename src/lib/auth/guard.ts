// API 鉴权守卫（零信任落地第一步）
// 背景：此前所有 /api/* 路由完全无鉴权——任何人可消耗平台 AI 配额、
// 读写（密文）同步数据。session.ts 写了完整 session 体系但无路由调用（死代码）。
// 当前为单用户部署，最小可用方案：共享令牌 SYNC_TOKEN（wrangler secret），
// 客户端经 Authorization: Bearer 携带。多用户时再升级为 session/nonce 体系。
import { NextResponse } from 'next/server';
import { getEnv } from './session';
import { sha256 } from '@/lib/utils';

/**
 * 校验请求的 Bearer token 是否与服务端 SYNC_TOKEN 一致。
 * - 未配置 SYNC_TOKEN → 503（fail-closed：宁可服务不可用，不可裸奔）
 * - 缺失/错误 token → 401
 * - 通过 → null（调用方继续处理）
 *
 * 比较双方 sha256 后再比对，避免朴素字符串比较的时序侧信道。
 */
export async function requireAuth(req: Request): Promise<NextResponse | null> {
  const env = getEnv();
  const expected = env.SYNC_TOKEN;

  if (!expected) {
    return NextResponse.json(
      {
        error:
          '服务端未配置访问令牌。请运行 `wrangler secret put SYNC_TOKEN`（本地开发写入 .dev.vars），然后在应用设置页填入同一令牌。',
      },
      { status: 503 }
    );
  }

  const header = req.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!provided) {
    return NextResponse.json({ error: '缺少访问令牌（Authorization: Bearer）' }, { status: 401 });
  }

  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  if (a !== b) {
    return NextResponse.json({ error: '访问令牌不正确' }, { status: 401 });
  }

  return null;
}
