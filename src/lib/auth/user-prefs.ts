// 用户偏好管理（本地存储 MASTER_KEY 与 BYOK keys）
// 拆分要点：crypto 模块内含 BIP39 英文词表（≈17KB JSON），仅在生成/恢复助记词、
// 加密 BYOK Key 时需要。把它改为按需动态 import，使只读 prefs 的页面
// （sidebar / 今日页 / 检索页 / 复习页）不再被迫加载 BIP39 词表。
import { getDb } from '@/lib/db/schema';
import type { UserPrefs, ReviewPreset } from '@/types';
import { now, sha256 } from '@/lib/utils';

const PREFS_ID = 'singleton' as const;

// 内存缓存 masterKeyHash 与 CryptoKey（避免重复导入）
let _cachedMasterKey: string | null = null;
let _cachedMnemonic: string | null = null;
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

/**
 * 懒生成：第一次需要加密 BYOK Key 时调用。
 * 生成 12 词助记词 → 派生 master key → 缓存 → 仅存 hash 到 IndexedDB。
 * 助记词本身只在内存中（供设置页「高级」区块展示），不落 IndexedDB。
 */
export async function ensureMasterKey(): Promise<{ mnemonic: string; masterKey: string }> {
  if (_cachedMnemonic && _cachedMasterKey) {
    return { mnemonic: _cachedMnemonic, masterKey: _cachedMasterKey };
  }

  const { generateMnemonicAsync, masterKeyFromMnemonic, importKeyFromBase64 } = await import(
    '@/lib/crypto'
  );
  const mnemonic = await generateMnemonicAsync();
  const masterKey = await masterKeyFromMnemonic(mnemonic);

  _cachedMnemonic = mnemonic;
  _cachedMasterKey = masterKey;
  _cachedCryptoKey = await importKeyFromBase64(masterKey);

  const db = getDb();
  const prefs = await getOrCreateUserPrefs();
  await db.userPrefs.put({
    ...prefs,
    masterKeyHash: await sha256(masterKey),
    updatedAt: now(),
  });

  return { mnemonic, masterKey };
}

/** 返回当前内存中的助记词（若已通过 ensureMasterKey 或 restoreFromMnemonic 载入）。 */
export function getCachedMnemonic(): string | null {
  return _cachedMnemonic;
}

/** 从外部助记词恢复 master key（换设备场景）。 */
export async function restoreFromMnemonic(mnemonic: string): Promise<void> {
  const { validateMnemonic, masterKeyFromMnemonic, importKeyFromBase64 } = await import(
    '@/lib/crypto'
  );
  const { ok, words, error } = await validateMnemonic(mnemonic);
  if (!ok) {
    throw new Error(error ?? '助记词格式不正确：需要 12 个有效英文单词');
  }
  const normalized = words.join(' ');
  const masterKey = await masterKeyFromMnemonic(normalized);

  const prefs = await getOrCreateUserPrefs();
  const hash = await sha256(masterKey);
  if (prefs.masterKeyHash && prefs.masterKeyHash !== hash) {
    throw new Error('助记词与本设备已存的密钥不匹配，请检查');
  }

  _cachedMnemonic = normalized;
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
  const { importKeyFromBase64 } = await import('@/lib/crypto');
  _cachedCryptoKey = await importKeyFromBase64(mk);
  return _cachedCryptoKey;
}

// 加密 BYOK key 存储
export async function saveByokKey(provider: string, apiKey: string): Promise<void> {
  // 懒生成：第一次保存 BYOK Key 时自动生成 MASTER_KEY
  await ensureMasterKey();
  const key = await getCryptoKey();
  if (!key) throw new Error('MASTER_KEY 未初始化');

  const { encrypt } = await import('@/lib/crypto');
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
  const { decrypt } = await import('@/lib/crypto');
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
