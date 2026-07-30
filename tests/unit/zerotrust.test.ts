// 零信任多用户登录测试：模拟完整挑战应答登录流 + 跨用户隔离 + nonce 防重放
// 用内存 KV 模拟 Cloudflare KV，并 mock getCloudflareContext 让真实 session/guard/zerotrust 跑起来
import { describe, it, expect, vi, beforeEach } from 'vitest';

class InMemoryKV {
  private store = new Map<string, { value: string; metadata?: unknown }>();
  async get(key: string, options?: { type?: 'json' | 'text' }): Promise<any> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (options?.type === 'json') return JSON.parse(entry.value);
    return entry.value;
  }
  async put(
    key: string,
    value: string,
    _options?: { expirationTtl?: number; metadata?: unknown }
  ): Promise<void> {
    this.store.set(key, { value, metadata: _options?.metadata });
  }
  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string; metadata?: unknown }> }> {
    const keys = [...this.store.keys()]
      .filter((k) => !options?.prefix || k.startsWith(options.prefix))
      .map((name) => ({ name, metadata: this.store.get(name)!.metadata }));
    return { keys };
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

const sessions = new InMemoryKV();
const nonces = new InMemoryKV();
const users = new InMemoryKV();
const mockEnv: any = { AUTH_SESSIONS: sessions, AUTH_NONCES: nonces, AUTH_USERS: users };

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: mockEnv }),
}));

import { sha256 } from '@/lib/utils';
import { registerOrGetUser, issueChallenge, consumeChallenge, verifyLogin } from '@/lib/auth/zerotrust';
import { verifyNonce } from '@/lib/auth/session';
import { resolveAuth } from '@/lib/auth/guard';

// 与客户端的 client-auth.ts 派生方式完全一致（零知识）
async function userIdOf(mk: string) {
  return sha256(`uid|${mk}`);
}
async function verifierOf(mk: string) {
  return sha256(`vrf|${mk}`);
}

function makeReq(token?: string): Request {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://localhost/api/test', { method: 'POST', headers });
}

describe('零信任登录', () => {
  beforeEach(() => {
    sessions.clear();
    nonces.clear();
    users.clear();
    delete mockEnv.SYNC_TOKEN;
  });

  it('完整登录流：注册→挑战→应答→会话令牌，且令牌解析出正确 userId', async () => {
    const mk = 'masterkey-abc-123';
    const userId = await userIdOf(mk);
    const verifier = await verifierOf(mk);

    await registerOrGetUser(userId, verifier);
    const challenge = await issueChallenge(userId);
    const response = await sha256(`${verifier}|${challenge}`);
    const sessionId = await verifyLogin(userId, challenge, response);
    expect(sessionId).toBeTruthy();

    const auth = await resolveAuth(makeReq(sessionId!));
    expect(auth.err).toBeNull();
    expect(auth.userId).toBe(userId);
    expect(auth.legacy).toBe(false);
  });

  it('主密钥错误 → 应答不匹配 → 登录失败（返回 null）', async () => {
    const userId = await userIdOf('real-mk');
    const verifier = await verifierOf('real-mk');
    await registerOrGetUser(userId, verifier);
    const challenge = await issueChallenge(userId);
    const sessionId = await verifyLogin(userId, challenge, 'wrong-response');
    expect(sessionId).toBeNull();
  });

  it('挑战一次性：成功登录后同一挑战作废，重放被拒', async () => {
    const mk = 'mk-once';
    const userId = await userIdOf(mk);
    const verifier = await verifierOf(mk);
    await registerOrGetUser(userId, verifier);
    const challenge = await issueChallenge(userId);
    const response = await sha256(`${verifier}|${challenge}`);

    // 第一次（模仿路由：先消费挑战再校验）
    const stored1 = await consumeChallenge(userId);
    expect(stored1).toBe(challenge);
    const s1 = await verifyLogin(userId, challenge, response);
    expect(s1).toBeTruthy();

    // 第二次用同一挑战：挑战已被消费，路由会在 consume 阶段拒绝
    const stored2 = await consumeChallenge(userId);
    expect(stored2).toBeNull();
  });

  it('服务端只存 verifier，不含明文主密钥，且无法反推', async () => {
    const mk = 'super-secret-mk';
    const userId = await userIdOf(mk);
    const verifier = await verifierOf(mk);
    await registerOrGetUser(userId, verifier);
    const raw = await users.get(`user:${userId}`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.verifier).toBe(verifier);
    expect(parsed.verifier).not.toContain('super-secret-mk');
    expect(verifier).not.toBe(mk);
  });

  it('跨用户隔离：A 的会话令牌解析出 A 的 userId，不会串到 B', async () => {
    const uA = await userIdOf('A-mk');
    const uB = await userIdOf('B-mk');
    const vA = await verifierOf('A-mk');
    const vB = await verifierOf('B-mk');
    await registerOrGetUser(uA, vA);
    await registerOrGetUser(uB, vB);
    const cA = await issueChallenge(uA);
    const cB = await issueChallenge(uB);
    const sA = (await verifyLogin(uA, cA, await sha256(`${vA}|${cA}`)))!;
    const sB = (await verifyLogin(uB, cB, await sha256(`${vB}|${cB}`)))!;

    const authA = await resolveAuth(makeReq(sA));
    const authB = await resolveAuth(makeReq(sB));
    expect(authA.userId).toBe(uA);
    expect(authB.userId).toBe(uB);
    expect(authA.userId).not.toBe(authB.userId);
  });

  it('向后兼容：仍接受遗留 SYNC_TOKEN（映射到单用户 local）', async () => {
    mockEnv.SYNC_TOKEN = 'legacy-token';
    const auth = await resolveAuth(makeReq('legacy-token'));
    expect(auth.err).toBeNull();
    expect(auth.userId).toBe('local');
    expect(auth.legacy).toBe(true);
    delete mockEnv.SYNC_TOKEN;
  });

  it('verifyNonce：同用户重复 nonce 被拒；不同用户互不干扰', async () => {
    expect(await verifyNonce('u1', 'nonce-1')).toBe(true);
    expect(await verifyNonce('u1', 'nonce-1')).toBe(false); // 重放
    expect(await verifyNonce('u2', 'nonce-1')).toBe(true); // 隔离
  });
});
