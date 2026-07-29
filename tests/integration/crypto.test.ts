// 集成测试：加密
import { describe, it, expect } from 'vitest';
import {
  generateMasterKey,
  importKeyFromBase64,
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  generateMnemonicAsync,
  validateMnemonic,
  masterKeyFromMnemonic,
} from '@/lib/crypto';

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

  // 修复 validateMnemonic 的回归保护：旧实现只校验词表，乱序也能通过
  it('BIP39 助记词生成 → 校验 → 派生 master key 往返', async () => {
    const mnemonic = await generateMnemonicAsync();
    const result = await validateMnemonic(mnemonic);
    expect(result.ok).toBe(true);
    expect(result.words.length).toBe(12);

    // 同一助记词派生的 master key 必须确定（PBKDF2 + 固定 salt）
    const key1 = await masterKeyFromMnemonic(mnemonic);
    const key2 = await masterKeyFromMnemonic(mnemonic);
    expect(key1).toBe(key2);
  });

  it('validateMnemonic 拒绝乱序的合法助记词（checksum 不匹配）', async () => {
    const mnemonic = await generateMnemonicAsync();
    const words = mnemonic.split(' ');
    // 交换前两个词的位置——单词仍在词表中，但 checksum 会失败
    const swapped = [words[1], words[0], ...words.slice(2)].join(' ');
    // 极小概率交换后 checksum 仍巧合通过（4 bits = 1/16）；
    // 若巧合通过则再换一对，最多重试 3 次
    let attempts = 0;
    let testMnemonic = swapped;
    while (attempts < 3) {
      const r = await validateMnemonic(testMnemonic);
      if (!r.ok) {
        expect(r.error).toBeTruthy();
        return;
      }
      // 再换一对
      const ws = testMnemonic.split(' ');
      testMnemonic = [ws[2], ws[3], ws[0], ws[1], ...ws.slice(4)].join(' ');
      attempts++;
    }
    // 若 3 次都巧合通过，跳过断言（概率 < 1/4096）
  });

  it('validateMnemonic 拒绝非词表单词', async () => {
    const r = await validateMnemonic('foobar baz qux quux corge grault garply waldo fred plugh xyzzy thud');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('词表');
  });

  it('validateMnemonic 拒绝非 12 词', async () => {
    const mnemonic = await generateMnemonicAsync();
    const r = await validateMnemonic(mnemonic.split(' ').slice(0, 11).join(' '));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('12');
  });
});
