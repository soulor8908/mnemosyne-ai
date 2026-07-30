import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// 强制用 Node 原生 TextEncoder/TextDecoder
// jsdom 提供的 TextEncoder 返回的 Uint8Array 在 Node 24 webcrypto 里
// 会被拒绝（"not instance of ArrayBuffer, Buffer, TypedArray, or DataView"），
// 因为 jsdom 的 buffer 实现与 Node 原生 ArrayBuffer 不兼容。
const { TextEncoder, TextDecoder } = require('util');
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

// 强制用 Node 原生 crypto（含 subtle），覆盖 jsdom 可能不完整的实现
// Node 24 里 globalThis.crypto 可能是只读的，用 defineProperty 强制覆盖
const { webcrypto } = require('crypto');
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
