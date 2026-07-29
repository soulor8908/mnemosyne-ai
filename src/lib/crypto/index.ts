// 加密工具：基于 Web Crypto API
// 浏览器与 Cloudflare Workers 都支持 crypto.subtle
import { sha256 } from '@/lib/utils';

const subtle = globalThis.crypto?.subtle;

if (!subtle) {
  throw new Error('crypto.subtle is required but not available');
}

// BufferSource 兼容：强制转为 ArrayBuffer
function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// 从密码派生 AES-GCM 密钥
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    toBufferSource(enc.encode(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: toBufferSource(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// 生成随机密钥（32 字节）
export function generateMasterKey(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

// ─── BIP39 助记词（12 词，对人类友好） ───
// 16 字节熵 → 12 词助记词；从助记词派生 32 字节 master key
import BIP39_WORDLIST from './bip39-en.json';

const BIP39_STRENGTH_BYTES = 16; // 128 bit → 12 词

// 生成 12 词助记词（async，因 Web Crypto subtle.digest 是 async）
export async function generateMnemonicAsync(): Promise<string> {
  const entropy = new Uint8Array(BIP39_STRENGTH_BYTES);
  globalThis.crypto.getRandomValues(entropy);

  const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', toBufferSource(entropy));
  const hash = new Uint8Array(hashBuf);

  const entropyBits = entropy.length * 8;
  const checksumBits = entropyBits / 32;
  const totalBits = entropyBits + checksumBits;

  // entropy + 校验位首字节
  const combined = new Uint8Array(entropy.length + 1);
  combined.set(entropy, 0);
  combined[entropy.length] = hash[0];

  const words: string[] = [];
  for (let i = 0; i < totalBits; i += 11) {
    let idx = 0;
    for (let j = 0; j < 11; j++) {
      const bitPos = i + j;
      const bytePos = Math.floor(bitPos / 8);
      const bitInByte = 7 - (bitPos % 8);
      const bit = (combined[bytePos] >> bitInByte) & 1;
      idx = (idx << 1) | bit;
    }
    words.push(BIP39_WORDLIST[idx & 0x7ff]);
  }

  return words.slice(0, 12).join(' ');
}

// 从助记词派生 32 字节 master key（base64）
// 用 PBKDF2 + 助记词作为 password，固定 salt（mnemosyne-v1）派生 32 字节
export async function masterKeyFromMnemonic(mnemonic: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    toBufferSource(enc.encode(mnemonic.normalize('NFKD'))),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const derived = await subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('mnemosyne-master-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await subtle.exportKey('raw', derived);
  return bytesToBase64(new Uint8Array(raw));
}

// 校验助记词：12 个单词、全部在词表中、BIP39 checksum 一致
// 修复要点：旧实现只校验"词数 + 词表"，12 个合法词乱序也能通过校验，
// 用户输错顺序时会在下游 masterKeyFromMnemonic 后比对 masterKeyHash 失败，
// 错误信息（"助记词与本设备已存的密钥不匹配"）让人困惑——以为是密钥错，
// 实际是助记词顺序/单词错了。这里加 checksum 校验，提供准确的失败原因。
export async function validateMnemonic(mnemonic: string): Promise<{ ok: boolean; words: string[]; error?: string }> {
  const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 12) {
    return { ok: false, words, error: '助记词必须是 12 个单词' };
  }
  const wordIndex = new Map<string, number>();
  for (let i = 0; i < BIP39_WORDLIST.length; i++) {
    wordIndex.set(BIP39_WORDLIST[i], i);
  }
  const indices: number[] = [];
  for (const w of words) {
    const idx = wordIndex.get(w);
    if (idx === undefined) {
      return { ok: false, words, error: `单词不在 BIP39 词表中：${w}` };
    }
    indices.push(idx);
  }

  // 12 词 = 132 bits = 128 bits entropy + 4 bits checksum
  // 还原 17 字节（128+8 bits）的 combined，再取前 16 字节作为 entropy
  const combined = new Uint8Array(17);
  let bitPos = 0;
  for (const idx of indices) {
    for (let j = 10; j >= 0; j--) {
      const bit = (idx >> j) & 1;
      const bytePos = Math.floor(bitPos / 8);
      const bitInByte = 7 - (bitPos % 8);
      if (bit) combined[bytePos] |= 1 << bitInByte;
      bitPos++;
    }
  }
  const entropy = combined.slice(0, 16);
  // 取 combined 第 16 字节的高 4 位作为助记词携带的 checksum（128/32 = 4 bits）
  const storedChecksum = (combined[16] >> 4) & 0xf;

  const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', toBufferSource(entropy));
  const hash = new Uint8Array(hashBuf);
  const computedChecksum = (hash[0] >> 4) & 0xf; // 高 4 位

  if (storedChecksum !== computedChecksum) {
    return { ok: false, words, error: '助记词校验失败：单词或顺序有误' };
  }
  return { ok: true, words };
}

// 从 base64 字符串导入 AES-GCM 密钥
export async function importKeyFromBase64(b64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(b64);
  return subtle.importKey('raw', toBufferSource(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// 导出密钥为 base64
export async function exportKeyToBase64(key: CryptoKey): Promise<string> {
  const raw = await subtle.exportKey('raw', key);
  return bytesToBase64(new Uint8Array(raw));
}

// 加密字符串
export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, toBufferSource(enc.encode(plaintext)));
  // iv + cipher 拼接
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return bytesToBase64(combined);
}

// 解密字符串
export async function decrypt(ciphertextB64: string, key: CryptoKey): Promise<string> {
  const combined = base64ToBytes(ciphertextB64);
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: toBufferSource(iv) }, key, toBufferSource(cipher));
  return new TextDecoder().decode(plain);
}

// 加密 JSON 对象
export async function encryptJSON(obj: unknown, key: CryptoKey): Promise<string> {
  return encrypt(JSON.stringify(obj), key);
}

// 解密 JSON 对象
export async function decryptJSON<T = unknown>(ciphertextB64: string, key: CryptoKey): Promise<T> {
  const plain = await decrypt(ciphertextB64, key);
  return JSON.parse(plain) as T;
}

// 工具：bytes <-> base64
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// hash 密钥用于校验（不存储原密钥）
export async function hashKey(key: string): Promise<string> {
  return sha256(key);
}
