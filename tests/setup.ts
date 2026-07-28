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
