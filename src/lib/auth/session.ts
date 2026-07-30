// 服务端 session 管理（零信任）
// 通过 @opennextjs/cloudflare 的 getCloudflareContext 获取 env
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { cookies } from 'next/headers';
import { nanoid } from 'nanoid';
import { sha256 } from '@/lib/utils';

const SESSION_COOKIE = 'mnemosyne_session';
// 安全修复说明：曾定义 x-mnemosyne-key header 用于客户端向服务端"透传"MASTER_KEY，
// 这与"主密钥永不离开客户端"的端到端加密承诺直接冲突，且从未被调用。
// 已彻底删除该通道；服务端鉴权改用 SYNC_TOKEN Bearer 令牌（见 guard.ts）。

// Cloudflare 环境类型（最小定义，避免依赖 @cloudflare/workers-types）
interface KVNamespace {
  get(key: string, options?: { type?: 'json' | 'text' }): Promise<string | null>;
  get(key: string, options: { type: 'json' }): Promise<any | null>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string; metadata?: unknown }> }>;
  delete(key: string): Promise<void>;
}

interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

interface FetcherBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  KV: KVNamespace;
  NOTES_DELTA: KVNamespace;
  AUTH_SESSIONS: KVNamespace;
  AUTH_NONCES: KVNamespace;
  AUTH_AUDIT: KVNamespace;
  AI: AiBinding;
  ASSETS: FetcherBinding;
  AI_PROVIDER: string;
  APP_URL: string;
  /** API 访问令牌（wrangler secret put SYNC_TOKEN；本地开发写 .dev.vars） */
  SYNC_TOKEN?: string;
  DEEPSEEK_API_KEY?: string;
  GLM_API_KEY?: string;
}

export function getEnv(): Env {
  const ctx = getCloudflareContext();
  return ctx.env as unknown as Env;
}

// 建立 session（首次使用）
export async function createSession(userId: string): Promise<string> {
  const env = getEnv();
  const sessionId = nanoid(32);
  const now = Date.now();
  await env.AUTH_SESSIONS.put(
    `sess:${sessionId}`,
    JSON.stringify({ userId, createdAt: now }),
    { expirationTtl: 7 * 24 * 3600 }
  );
  return sessionId;
}

// 校验 session 并返回 userId
export async function verifySession(): Promise<string | null> {
  const env = getEnv();
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const raw = await env.AUTH_SESSIONS.get(`sess:${sessionId}`);
  if (!raw) return null;
  const data = JSON.parse(raw) as { userId: string; createdAt: number };
  return data.userId;
}

// 校验 nonce（防重放）
export async function verifyNonce(nonce: string): Promise<boolean> {
  const env = getEnv();
  const key = `nonce:${nonce}`;
  const existing = await env.AUTH_NONCES.get(key);
  if (existing) return false; // 重放
  await env.AUTH_NONCES.put(key, Date.now().toString(), { expirationTtl: 300 });
  return true;
}

// 写审计日志
export async function audit(userId: string, event: string, meta?: Record<string, unknown>): Promise<void> {
  const env = getEnv();
  const ts = Date.now();
  await env.AUTH_AUDIT.put(
    `audit:${userId}:${ts}:${nanoid(6)}`,
    JSON.stringify({ event, meta, ts }),
    { expirationTtl: 90 * 24 * 3600 }
  );
}

export function setSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;
}

export { sha256 };
