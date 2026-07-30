// API 鉴权守卫测试：锁定"fail-closed + Bearer 校验"行为
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 掉 Cloudflare context，直接控制 env
const mockEnv: { SYNC_TOKEN?: string } = {};
vi.mock('@/lib/auth/session', () => ({
  getEnv: () => mockEnv,
}));

import { requireAuth } from '@/lib/auth/guard';

function makeReq(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new Request('http://localhost/api/test', { method: 'POST', headers });
}

describe('requireAuth', () => {
  beforeEach(() => {
    delete mockEnv.SYNC_TOKEN;
  });

  it('未配置 SYNC_TOKEN 时 fail-closed（503），绝不放行', async () => {
    const res = await requireAuth(makeReq('Bearer anything'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
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

  it('令牌正确时放行（返回 null）', async () => {
    mockEnv.SYNC_TOKEN = 'top-secret';
    const res = await requireAuth(makeReq('Bearer top-secret'));
    expect(res).toBeNull();
  });

  it('令牌两侧空白被容忍（客户端粘贴常见）', async () => {
    mockEnv.SYNC_TOKEN = 'top-secret';
    const res = await requireAuth(makeReq('Bearer  top-secret '));
    expect(res).toBeNull();
  });
});
