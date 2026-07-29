import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Polyfill TextEncoder/Decoder for tests
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// Polyfill crypto.subtle for tests
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = require('crypto');
  globalThis.crypto = webcrypto;
}

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
