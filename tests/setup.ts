import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// 强制用 Node 原生 TextEncoder/TextDecoder
// jsdom 提供的 TextEncoder 返回的 Uint8Array 在 Node 24 webcrypto 里
// 会被拒绝（"not instance of ArrayBuffer, Buffer, TypedArray, or DataView"），
// 因为 jsdom 的 buffer 实现与 Node 原生 ArrayBuffer 不兼容。
const { TextEncoder, TextDecoder } = require('util');
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

// 修复 cross-realm BufferSource 问题：
// jsdom 环境里的 ArrayBuffer/Uint8Array 属于 jsdom realm，
// Node 24 的 webcrypto 用 instanceof 检查会拒绝跨 realm 的对象。
// 方案：patch crypto.subtle 的方法，用 Node Buffer 做桥梁转换参数。
const { webcrypto } = require('crypto');
const { Buffer } = require('buffer');

const nativeSubtle = webcrypto.subtle;

// 将任何 BufferSource 转为 Node 原生 ArrayBuffer（通过 Buffer 桥梁）
// 关键：必须用 Buffer.alloc() 创建全新内存，不能用 Buffer.from(data)——
// 后者共享原始内存，buf.buffer 仍指向 jsdom realm 的 ArrayBuffer。
function toNativeArrayBuffer(data: unknown): ArrayBuffer {
  let source: Uint8Array;
  if (data instanceof ArrayBuffer) {
    source = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    source = new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
  } else {
    source = Buffer.from(String(data));
  }
  // alloc 创建全新的 Node 原生 Buffer，其 buffer 是 Node 原生 ArrayBuffer
  const buf = Buffer.alloc(source.byteLength);
  buf.set(source);
  return buf.buffer;
}

// Patch digest：转换 data 参数
const origDigest = nativeSubtle.digest.bind(nativeSubtle);
nativeSubtle.digest = function (algorithm: AlgorithmIdentifier, data: BufferSource) {
  return origDigest(algorithm, toNativeArrayBuffer(data) as BufferSource);
};

// Patch importKey：转换 keyData 参数
const origImportKey = nativeSubtle.importKey.bind(nativeSubtle);
nativeSubtle.importKey = function (
  format: KeyFormat,
  keyData: BufferSource | JsonWebKey,
  algorithm: AlgorithmIdentifier,
  extractable: boolean,
  keyUsages: KeyUsage[]
) {
  if (format !== 'jwk' && keyData) {
    keyData = toNativeArrayBuffer(keyData) as BufferSource;
  }
  return origImportKey(format, keyData, algorithm, extractable, keyUsages);
};

// 递归转换 algorithm 对象里所有 BufferSource 字段为 Node 原生 ArrayBuffer
// 必修场景：AES-GCM.iv / AES-GCM.additionalData / PBKDF2.salt / HKDF.salt / HKDF.info
// Node 20 webcrypto 比 Node 24 严格，algorithm 内嵌的 BufferSource 也按 realm 检查。
function normalizeAlgorithm<T extends AlgorithmIdentifier>(algorithm: T): T {
  if (!algorithm || typeof algorithm !== 'object') return algorithm;
  const out: any = { ...(algorithm as any) };
  // 已知 BufferSource 字段清单
  const bufferFields = ['iv', 'salt', 'info', 'additionalData', 'public', 'data'] as const;
  for (const f of bufferFields) {
    if (out[f] != null && typeof out[f] !== 'string') {
      out[f] = toNativeArrayBuffer(out[f]);
    }
  }
  return out as T;
}

// Patch encrypt/decrypt：转换 algorithm 中的 BufferSource 字段 + data 参数
const origEncrypt = nativeSubtle.encrypt.bind(nativeSubtle);
nativeSubtle.encrypt = function (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) {
  return origEncrypt(normalizeAlgorithm(algorithm), key, toNativeArrayBuffer(data) as BufferSource);
};

const origDecrypt = nativeSubtle.decrypt.bind(nativeSubtle);
nativeSubtle.decrypt = function (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) {
  return origDecrypt(normalizeAlgorithm(algorithm), key, toNativeArrayBuffer(data) as BufferSource);
};

// Patch deriveKey/deriveBits：转换 algorithm 中的 salt/info
const origDeriveBits = nativeSubtle.deriveBits.bind(nativeSubtle);
nativeSubtle.deriveBits = function (algorithm: AlgorithmIdentifier, baseKey: CryptoKey, length: number) {
  return origDeriveBits(normalizeAlgorithm(algorithm), baseKey, length);
};

const origDeriveKey = nativeSubtle.deriveKey.bind(nativeSubtle);
nativeSubtle.deriveKey = function (
  algorithm: AlgorithmIdentifier,
  baseKey: CryptoKey,
  derivedKeyAlgo: AlgorithmIdentifier,
  extractable: boolean,
  keyUsages: KeyUsage[]
) {
  return origDeriveKey(normalizeAlgorithm(algorithm), baseKey, derivedKeyAlgo, extractable, keyUsages);
};

// 强制用 Node 原生 crypto
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
});

// Polyfill Request/Response for API route tests
if (typeof globalThis.Request === 'undefined') {
  const { Request, Response, Headers } = require('undici');
  globalThis.Request = Request;
  globalThis.Response = Response;
  globalThis.Headers = Headers;
}

// Polyfill File.prototype.text（jsdom 的 File 缺少 text()，浏览器原生有）
// 现有 importFromMarkdownFiles 与 inbox ingest 都依赖 file.text()
if (typeof globalThis.File !== 'undefined' && !File.prototype.text) {
  File.prototype.text = function (): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
