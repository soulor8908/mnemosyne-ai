// 客户端 API 封装：所有 /api/* 请求统一从这里走，自动附带访问令牌。
// 令牌可以是：遗留共享令牌 SYNC_TOKEN（单用户）或零信任登录后的会话令牌（多用户）。
// 由设置页或 /login 页保存；注意：这是"访问令牌"，不是 MASTER_KEY——主密钥永不离开客户端。
const TOKEN_STORAGE_KEY = 'mnemosyne_sync_token';

export function getSyncToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setSyncToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级：请求将以未认证方式发出并被服务端拒绝
  }
}

// 防止并发 401 触发多次重登
let _reloginPromise: Promise<boolean> | null = null;

/**
 * 带鉴权的 fetch：自动附加 Authorization: Bearer <token>。
 * session 过期（401）时自动尝试用内存中的助记词重登并重试请求；
 * 无法重登（无缓存助记词）则跳转 /login。
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getSyncToken();
  const headers = new Headers(init.headers);
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  const res = await fetch(input, { ...init, headers });

  // 401 自动重登：session 过期时，若内存中有助记词，自动刷新 session 并重试
  if (res.status === 401 && typeof window !== 'undefined') {
    // 登录/认证相关端点的 401 不触发重登（避免死循环）
    if (input.includes('/api/auth/')) {
      return res;
    }

    if (!_reloginPromise) {
      _reloginPromise = (async () => {
        const { autoRelogin } = await import('@/lib/auth/client-auth');
        return autoRelogin();
      })();
    }
    const ok = await _reloginPromise;
    _reloginPromise = null;

    if (ok) {
      // 重登成功，带新 token 重试原请求
      const newToken = getSyncToken();
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set('authorization', `Bearer ${newToken}`);
      return fetch(input, { ...init, headers: retryHeaders });
    }

    // 重登失败（无缓存助记词），跳 /login 并记录来源页
    if (window.location.pathname !== '/login') {
      const from = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?from=${from}`;
    }
  }

  return res;
}
