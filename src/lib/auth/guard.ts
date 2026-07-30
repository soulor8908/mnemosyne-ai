// API 鉴权守卫（零信任落地）
// 接受两类凭据，任一通过即放行：
//   1) 遗留共享令牌 SYNC_TOKEN（单用户/管理态，Bearer 携带）
//   2) 零信任会话令牌（多用户登录后签发，Bearer 携带，按用户隔离）
// 解析结果含 userId，供需要用户隔离的路由（如同步）使用。
import { NextResponse } from 'next/server';
import { getEnv } from './session';
import { sha256 } from '@/lib/utils';

export interface AuthResult {
  /** 通过时为 userId（'local' 表示遗留共享令牌的匿名单用户）；拒绝时为 null */
  userId: string | null;
  /** 是否走遗留共享令牌（非会话令牌） */
  legacy: boolean;
  /** 拒绝时返回 401/503 响应；通过时为 null */
  err: NextResponse | null;
}

function unauthorized(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 401 });
}

/**
 * 解析请求身份。
 * - 未配置任何令牌 → 503（fail-closed：宁可服务不可用，不可裸奔）
 * - 缺失/错误令牌 → 401
 * - 通过 → { userId, legacy, err: null }
 * 比较双方 sha256 后再比对，避免朴素字符串比较的时序侧信道。
 */
export async function resolveAuth(req: Request): Promise<AuthResult> {
  const env = getEnv();
  const header = req.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!provided) {
    return { userId: null, legacy: false, err: unauthorized('缺少访问令牌（Authorization: Bearer）') };
  }

  // 1) 遗留共享令牌（单用户/管理态）
  if (env.SYNC_TOKEN) {
    const [a, b] = await Promise.all([sha256(provided), sha256(env.SYNC_TOKEN)]);
    if (a === b) return { userId: 'local', legacy: true, err: null };
  }

  // 2) 零信任会话令牌（多用户）
  if (provided.length >= 16) {
    const raw = await env.AUTH_SESSIONS.get(`sess:${provided}`);
    if (raw) {
      try {
        const data = JSON.parse(raw) as { userId: string };
        return { userId: data.userId, legacy: false, err: null };
      } catch {
        // 损坏的会话记录，按无效处理
      }
    }
  }

  return { userId: null, legacy: false, err: unauthorized('访问令牌不正确') };
}

/**
 * 兼容旧调用点：仅判断通过/拒绝，返回 NextResponse | null。
 * 需要 userId 的新路由请改用 resolveAuth。
 */
export async function requireAuth(req: Request): Promise<NextResponse | null> {
  const res = await resolveAuth(req);
  return res.err;
}
