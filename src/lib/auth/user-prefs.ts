// 用户偏好管理（本地存储 MASTER_KEY 与 BYOK keys）
import { getDb } from '@/lib/db/schema';
import type { UserPrefs, ReviewPreset } from '@/types';
import { now, sha256 } from '@/lib/utils';
import { generateMasterKey, importKeyFromBase64, encrypt, decrypt } from '@/lib/crypto';

const PREFS_ID = 'singleton' as const;

// 内存缓存 masterKeyHash 与 CryptoKey（避免重复导入）
let _cachedMasterKey: string | null = null;
let _cachedCryptoKey: CryptoKey | null = null;

export async function getOrCreateUserPrefs(): Promise<UserPrefs> {
  const db = getDb();
  let prefs = await db.userPrefs.get(PREFS_ID);
  if (!prefs) {
    prefs = {
      id: PREFS_ID,
      userId: crypto.randomUUID(),
      fsrsPreset: 'standard',
      privacyMode: false,
      autoApplyProposals: false,
      createdAt: now(),
      updatedAt: now(),
    };
    await db.userPrefs.add(prefs);
  }
  return prefs;
}

// 初始化 master key（首次使用时生成）
export async function initMasterKey(): Promise<string> {
  const existing = _cachedMasterKey;
  if (existing) return existing;

  const masterKey = generateMasterKey();
  _cachedMasterKey = masterKey;
  _cachedCryptoKey = await importKeyFromBase64(masterKey);

  // 存储 hash（不存原密钥）
  const db = getDb();
  const prefs = await getOrCreateUserPrefs();
  await db.userPrefs.put({
    ...prefs,
    masterKeyHash: await sha256(masterKey),
    updatedAt: now(),
  });

  return masterKey;
}

// 从外部设置 master key（恢复场景）
export async function setMasterKey(masterKey: string): Promise<void> {
  const prefs = await getOrCreateUserPrefs();
  const hash = await sha256(masterKey);
  if (prefs.masterKeyHash && prefs.masterKeyHash !== hash) {
    throw new Error('MASTER_KEY 与已存 hash 不匹配');
  }
  _cachedMasterKey = masterKey;
  _cachedCryptoKey = await importKeyFromBase64(masterKey);
  const db = getDb();
  await db.userPrefs.put({
    ...prefs,
    masterKeyHash: hash,
    updatedAt: now(),
  });
}

export function getCachedMasterKey(): string | null {
  return _cachedMasterKey;
}

export async function getCryptoKey(): Promise<CryptoKey | null> {
  if (_cachedCryptoKey) return _cachedCryptoKey;
  const mk = _cachedMasterKey;
  if (!mk) return null;
  _cachedCryptoKey = await importKeyFromBase64(mk);
  return _cachedCryptoKey;
}

// 加密 BYOK key 存储
export async function saveByokKey(provider: string, apiKey: string): Promise<void> {
  const key = await getCryptoKey();
  if (!key) throw new Error('MASTER_KEY 未初始化');

  const prefs = await getOrCreateUserPrefs();
  const byokKeys = prefs.byokKeys ?? {};
  byokKeys[provider] = await encrypt(apiKey, key);

  const db = getDb();
  await db.userPrefs.put({
    ...prefs,
    byokKeys,
    updatedAt: now(),
  });
}

export async function getDecryptedByokKey(provider: string): Promise<string | null> {
  const key = await getCryptoKey();
  if (!key) return null;
  const prefs = await getOrCreateUserPrefs();
  const cipher = prefs.byokKeys?.[provider];
  if (!cipher) return null;
  return decrypt(cipher, key);
}

export async function setFsrsPreset(preset: ReviewPreset): Promise<void> {
  const db = getDb();
  const prefs = await getOrCreateUserPrefs();
  await db.userPrefs.put({ ...prefs, fsrsPreset: preset, updatedAt: now() });
}

export async function setPrivacyMode(enabled: boolean): Promise<void> {
  const db = getDb();
  const prefs = await getOrCreateUserPrefs();
  await db.userPrefs.put({ ...prefs, privacyMode: enabled, updatedAt: now() });
}

// 测试用：重置
export function _resetAuthCache() {
  _cachedMasterKey = null;
  _cachedCryptoKey = null;
}
