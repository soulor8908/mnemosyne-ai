// 客户端 API 封装：所有 /api/* 请求统一从这里走，自动附带访问令牌。
// 令牌 = 服务端 SYNC_TOKEN（wrangler secret），用户在设置页填入一次。
// 注意：这是"访问令牌"，不是 MASTER_KEY——主密钥永不离开客户端。
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

/** 带鉴权的 fetch：自动附加 Authorization: Bearer <SYNC_TOKEN> */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getSyncToken();
  const headers = new Headers(init.headers);
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
