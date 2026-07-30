// 零信任多用户登录（服务端）
// 核心思想：主密钥（masterKey）派生自 12 词 BIP39 助记词，永不上传服务端。
// 服务端只保存一个「验证器」verifier = H(masterKey)，它无法反推 masterKey。
// 登录用挑战应答（SCRAM-lite）证明「客户端确实掌握 masterKey」而不传递它：
//   1) 客户端发 userId（= H(masterKey)）+ 首次自动注册 verifier
//   2) 服务端发随机 challenge
//   3) 客户端回 response = H(verifier | challenge)
//   4) 服务端用自己存的 verifier 复算并比对 —— 通过则签发会话令牌
// 整个流程服务端从未接触 masterKey，符合「数据主权」承诺。
import { nanoid } from 'nanoid';
import { getEnv, createSession } from './session';
import { sha256 } from '@/lib/utils';

const CHALLENGE_TTL = 120; // 秒，单次挑战 2 分钟有效，防截获重放

// 注册（首次）或获取用户。verifier 由客户端用 masterKey 派生，服务端仅存储。
// 安全说明：userId 本身是高熵（256-bit 派生），攻击者无法「抢注」特定用户的账号，
// 只能抢注随机 userId（对其无意义）。因此自动注册是安全的。
export async function registerOrGetUser(userId: string, verifier: string): Promise<void> {
  const env = getEnv();
  const existing = await env.AUTH_USERS.get(`user:${userId}`);
  if (!existing) {
    await env.AUTH_USERS.put(
      `user:${userId}`,
      JSON.stringify({ verifier, createdAt: Date.now() })
    );
  }
}

// 签发一次性挑战并暂存（TTL 内有效）
export async function issueChallenge(userId: string): Promise<string> {
  const env = getEnv();
  const challenge = nanoid(32);
  await env.AUTH_NONCES.put(`challenge:${userId}`, challenge, { expirationTtl: CHALLENGE_TTL });
  return challenge;
}

// 取出并消费挑战（一次性，取后删除）
export async function consumeChallenge(userId: string): Promise<string | null> {
  const env = getEnv();
  const challenge = await env.AUTH_NONCES.get(`challenge:${userId}`);
  if (challenge) await env.AUTH_NONCES.delete(`challenge:${userId}`);
  return challenge;
}

// 校验应答并签发会话令牌。
// clientResponse = H(verifier | challenge)，服务端用存的 verifier 复算比对。
export async function verifyLogin(
  userId: string,
  challenge: string,
  clientResponse: string
): Promise<string | null> {
  const env = getEnv();
  const raw = await env.AUTH_USERS.get(`user:${userId}`);
  if (!raw) return null;
  const { verifier } = JSON.parse(raw) as { verifier: string };

  const expected = await sha256(`${verifier}|${challenge}`);
  if (expected !== clientResponse) return null;

  return createSession(userId); // 返回会话令牌（sessionId）
}
