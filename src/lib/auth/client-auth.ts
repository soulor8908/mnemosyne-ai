// 客户端零信任登录流程（零知识挑战应答）
// 全程不向服务端发送主密钥或助记词，只发送：
//   userId   = H("uid|" + masterKey)   —— 账户标识，高熵
//   verifier = H("vrf|" + masterKey)   —— 验证器，服务端存储，无法反推 masterKey
//   response = H(verifier | challenge) —— 证明掌握 masterKey
import { sha256 } from '@/lib/utils';
import { masterKeyFromMnemonic } from '@/lib/crypto';
import { getCachedMnemonic } from '@/lib/auth/user-prefs';
import { apiFetch, setSyncToken, getSyncToken } from '@/lib/api/client';

/** 由主密钥派生账户标识（确定性，多设备一致） */
export async function deriveUserId(masterKey: string): Promise<string> {
  return sha256(`uid|${masterKey}`);
}

/** 由主密钥派生验证器（服务端存储，零知识） */
export async function deriveVerifier(masterKey: string): Promise<string> {
  return sha256(`vrf|${masterKey}`);
}

export interface LoginResult {
  sessionId: string;
  userId: string;
}

/**
 * 用本设备已初始化的助记词，走零知识挑战应答登录，拿回会话令牌并存入本设备。
 * 登录成功后，后续所有 /api/* 请求经 apiFetch 自动携带该会话令牌。
 */
export async function loginWithMnemonic(): Promise<LoginResult> {
  const mnemonic = getCachedMnemonic();
  if (!mnemonic) {
    throw new Error('本设备尚未初始化助记词，请先创建或恢复保险库');
  }
  const masterKey = await masterKeyFromMnemonic(mnemonic);
  const userId = await deriveUserId(masterKey);
  const verifier = await deriveVerifier(masterKey);

  // 1) 第一步：登记（首次）+ 取挑战
  const startRes = await apiFetch('/api/auth/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, verifier }),
  });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err.error || '登录初始化失败');
  }
  const { challenge } = await startRes.json();

  // 2) 第二步：回 response = H(verifier | challenge)
  const response = await sha256(`${verifier}|${challenge}`);
  const verifyRes = await apiFetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, challenge, response }),
  });
  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({}));
    throw new Error(err.error || '登录失败');
  }
  const { sessionId } = await verifyRes.json();

  // 复用同一令牌存储位（现在存的是会话令牌而非共享令牌）
  setSyncToken(sessionId);
  return { sessionId, userId };
}

/** 当前本设备是否已持有可用的登录令牌（会话或遗留共享令牌） */
export function hasStoredToken(): boolean {
  return getSyncToken().length > 0;
}
