// 单元测试：工具函数
import { describe, it, expect } from 'vitest';
import {
  fnv1aHash,
  extractTitleFromMarkdown,
  tokenize,
  cosineSimilarity,
  truncate,
} from '@/lib/utils';

describe('utils', () => {
  describe('fnv1aHash', () => {
    it('相同输入应产生相同哈希', () => {
      expect(fnv1aHash('hello')).toBe(fnv1aHash('hello'));
    });
    it('不同输入应产生不同哈希', () => {
      expect(fnv1aHash('hello')).not.toBe(fnv1aHash('world'));
    });
  });

  describe('extractTitleFromMarkdown', () => {
    it('从 H1 提取标题', () => {
      expect(extractTitleFromMarkdown('# 我的标题\n正文')).toBe('我的标题');
    });
    it('从普通文本提取第一行', () => {
      expect(extractTitleFromMarkdown('第一行\n第二行')).toBe('第一行');
    });
    it('去掉 markdown 标记', () => {
      expect(extractTitleFromMarkdown('**粗体标题**')).toBe('粗体标题');
    });
    it('空内容返回无标题', () => {
      expect(extractTitleFromMarkdown('')).toBe('无标题');
    });
  });

  describe('tokenize', () => {
    it('英文按词切分', () => {
      const tokens = tokenize('hello world');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });
    it('中文按字切分', () => {
      const tokens = tokenize('机器学习');
      expect(tokens).toContain('机');
      expect(tokens).toContain('器');
      expect(tokens).toContain('学');
      expect(tokens).toContain('习');
    });
  });

  describe('cosineSimilarity', () => {
    it('相同向量相似度为 1', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
    });
    it('正交向量相似度为 0', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    });
    it('不同长度返回 0', () => {
      expect(cosineSimilarity([1, 2], [1])).toBe(0);
    });
  });

  describe('truncate', () => {
    it('短文本不截断', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });
    it('长文本截断并加省略号', () => {
      expect(truncate('hello world', 8)).toBe('hello w…');
    });
  });
});
