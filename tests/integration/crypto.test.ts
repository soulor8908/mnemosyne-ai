// 集成测试：加密
import { describe, it, expect } from 'vitest';
import { generateMasterKey, importKeyFromBase64, encrypt, decrypt, encryptJSON, decryptJSON } from '@/lib/crypto';

describe('crypto', () => {
  it('加解密字符串往返', async () => {
    const mk = generateMasterKey();
    const key = await importKeyFromBase64(mk);
    const plaintext = '这是一段私密文字 hello world 123';
    const cipher = await encrypt(plaintext, key);
    expect(cipher).not.toBe(plaintext);
    const decrypted = await decrypt(cipher, key);
    expect(decrypted).toBe(plaintext);
  });

  it('加解密 JSON 往返', async () => {
    const mk = generateMasterKey();
    const key = await importKeyFromBase64(mk);
    const obj = { title: '测试', tags: ['a', 'b'], nested: { x: 1 } };
    const cipher = await encryptJSON(obj, key);
    const decrypted = await decryptJSON(cipher, key);
    expect(decrypted).toEqual(obj);
  });

  it('不同密钥加密的密文互不可解', async () => {
    const key1 = await importKeyFromBase64(generateMasterKey());
    const key2 = await importKeyFromBase64(generateMasterKey());
    const cipher = await encrypt('secret', key1);
    await expect(decrypt(cipher, key2)).rejects.toThrow();
  });
});
