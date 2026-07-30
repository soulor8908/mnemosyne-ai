// API 鉴权守卫测试：锁定"无效令牌拒绝 + 会话/遗留令牌双通道"行为
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 掉 Cloudflare context，直接控制 env
const mockEnv: any = { SYNC_TOKEN: undefined, AUTH_SESSIONS: { get: async () => null } };
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ env: mockEnv }),
}));

import { requireAuth, resolveAuth } from '@/lib/auth/guard';

function makeReq(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/api/test', { method: 'POST', headers });
}

describe('requireAuth / resolveAuth', () => {
  beforeEach(() => {
    mockEnv.SYNC_TOKEN = undefined;
  });

  it('零信任模式下无令牌/无效令牌一律 401（服务不裸奔，但始终要求鉴权而非 503）', async () => {
    const res = await requireAuth(makeReq('Bearer anything'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('缺少 Authorization header 时返回 401', async () => {
    mockEnv.SYNC_TOKEN = 'top-secret';
    const res = await requireAuth(makeReq());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('令牌错误时返回 401', async () => {
    mockEnv.SYNC_TOKEN = 'top-secret';
    const res = await requireAuth(makeReq('Bearer wrong-token'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('非 Bearer 格式（Basic 等）视为未提供令牌，返回 401', async () => {
    mockEnv.SYNC_TOKEN = 'top-secret';
    const res = await requireAuth(makeReq('Basic dXNlcjpwYXNz'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('遗留令牌正确时放行（返回 null）', async () => {
    mockEnv.SYNC_TOKEN = 'top-secret';
    const res = await requireAuth(makeReq('Bearer top-secret'));
    expect(res).toBeNull();
  });

  it('令牌两侧空白被容忍（客户端粘贴常见）', async () => {
    mockEnv.SYNC_TOKEN = 'top-secret';
    const res = await requireAuth(makeReq('Bearer  top-secret '));
    expect(res).toBeNull();
  });

  it('resolveAuth 返回 userId：遗留令牌映射到 local', async () => {
    mockEnv.SYNC_TOKEN = 'top-secret';
    const r = await resolveAuth(makeReq('Bearer top-secret'));
    expect(r.err).toBeNull();
    expect(r.userId).toBe('local');
    expect(r.legacy).toBe(true);
  });
});
