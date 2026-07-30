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
function toNativeArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    // 用 Buffer.from 复制到 Node 原生 ArrayBuffer
    const buf = Buffer.from(data);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const buf = Buffer.from(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  // 字符串等其他类型
  const buf = Buffer.from(String(data));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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

// Patch encrypt/decrypt：转换 data 参数
const origEncrypt = nativeSubtle.encrypt.bind(nativeSubtle);
nativeSubtle.encrypt = function (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) {
  return origEncrypt(algorithm, key, toNativeArrayBuffer(data) as BufferSource);
};

const origDecrypt = nativeSubtle.decrypt.bind(nativeSubtle);
nativeSubtle.decrypt = function (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) {
  return origDecrypt(algorithm, key, toNativeArrayBuffer(data) as BufferSource);
};

// Patch deriveKey/deriveBits：转换 salt/info 参数（第二参数）
const origDeriveBits = nativeSubtle.deriveBits.bind(nativeSubtle);
nativeSubtle.deriveBits = function (algorithm: AlgorithmIdentifier, baseKey: CryptoKey, length: number) {
  if (algorithm && typeof algorithm === 'object' && 'salt' in algorithm) {
    (algorithm as any).salt = toNativeArrayBuffer((algorithm as any).salt);
  }
  return origDeriveBits(algorithm, baseKey, length);
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
