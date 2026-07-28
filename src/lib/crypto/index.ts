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
