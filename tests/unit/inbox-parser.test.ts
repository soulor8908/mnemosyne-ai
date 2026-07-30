// 单元测试：inbox 文件解析器（飞书捕获通道的接缝契约）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseInboxFile,
  isIngestible,
  toNoteInput,
} from '@/lib/inbox/parser';

// 读取契约 fixture
const samplePath = resolve(__dirname, '../fixtures/inbox-sample.md');
const sampleContent = readFileSync(samplePath, 'utf-8');

describe('inbox parser', () => {
  describe('parseInboxFile', () => {
    it('正确解析标准 fixture 的全部字段', () => {
      const parsed = parseInboxFile(sampleContent);
      expect(parsed).not.toBeNull();
      const fm = parsed!.frontmatter;
      expect(fm.id).toBe('inbox_abc123def456');
      expect(fm.source).toBe('feishu-share');
      expect(fm.sourceUrl).toBe('https://example.com/article/ai-knowledge-management');
      expect(fm.feishuChatId).toBe('oc_sample_chat');
      expect(fm.feishuMessageId).toBe('om_sample_msg');
      expect(fm.title).toBe('AI 时代的知识管理：从收集到内化');
      expect(fm.author).toBe('张三');
      expect(fm.tags).toEqual(['AI', '知识管理', '笔记']);
      expect(fm.summary).toContain('探讨如何用 AI');
      expect(fm.knowledgePoints).toHaveLength(4);
      expect(fm.knowledgePoints?.[0]).toBe('AI 应负责整理结构而非替用户写作');
      expect(fm.status).toBe('inbox');
    });

    it('解析正文 body（含 ## 原文 与 ## 知识点 区块）', () => {
      const parsed = parseInboxFile(sampleContent);
      expect(parsed!.body).toContain('## 原文');
      expect(parsed!.body).toContain('这是一篇关于 AI 时代知识管理的文章正文');
      expect(parsed!.body).toContain('## 知识点');
    });

    it('支持 CRLF 行尾（Windows / 飞书导出兼容）', () => {
      // 注意：Windows 上 git autocrlf 检出的 fixture 可能已是 CRLF，
      // 直接 \n→\r\n 会产生 \r\r\n。先归一化为 LF 再转 CRLF，保证平台无关。
      const crlfContent = sampleContent.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      const parsed = parseInboxFile(crlfContent);
      expect(parsed).not.toBeNull();
      expect(parsed!.frontmatter.title).toBe('AI 时代的知识管理：从收集到内化');
      expect(parsed!.frontmatter.knowledgePoints).toHaveLength(4);
    });

    it('无 frontmatter 的文件返回 null', () => {
      const parsed = parseInboxFile('纯正文没有 frontmatter');
      expect(parsed).toBeNull();
    });

    it('frontmatter 缺少必需字段 id 返回 null', () => {
      const noId = sampleContent.replace(/^id:.*$/m, '');
      const parsed = parseInboxFile(noId);
      expect(parsed).toBeNull();
    });

    it('tags 支持 YAML 列表格式（- a\\n- b）', () => {
      const listTags = sampleContent.replace(
        'tags: [AI, 知识管理, 笔记]',
        'tags:\n  - AI\n  - 知识管理'
      );
      const parsed = parseInboxFile(listTags);
      expect(parsed!.frontmatter.tags).toEqual(['AI', '知识管理']);
    });
  });

  describe('isIngestible', () => {
    it('status=inbox 可入库', () => {
      const parsed = parseInboxFile(sampleContent)!;
      expect(isIngestible(parsed)).toBe(true);
    });

    it('status=inbox-raw 不可入库（等 Trae 重试）', () => {
      const raw = sampleContent.replace('status: inbox', 'status: inbox-raw');
      const parsed = parseInboxFile(raw)!;
      expect(isIngestible(parsed)).toBe(false);
    });

    it('status=ingested 不可入库（已处理）', () => {
      const done = sampleContent.replace('status: inbox', 'status: ingested');
      const parsed = parseInboxFile(done)!;
      expect(isIngestible(parsed)).toBe(false);
    });
  });

  describe('toNoteInput', () => {
    it('转换为 Note 输入，source=feishu，sourceMeta 含飞书回溯字段', () => {
      const parsed = parseInboxFile(sampleContent)!;
      const input = toNoteInput(parsed);
      expect(input.source).toBe('feishu');
      expect(input.id).toBe('inbox_abc123def456');
      expect(input.title).toBe('AI 时代的知识管理：从收集到内化');
      expect(input.tags).toEqual(['AI', '知识管理', '笔记']);
      expect(input.sourceMeta.url).toBe('https://example.com/article/ai-knowledge-management');
      expect(input.sourceMeta.feishuChatId).toBe('oc_sample_chat');
      expect(input.sourceMeta.feishuMessageId).toBe('om_sample_msg');
      // capturedAt 转 number（毫秒）
      expect(input.sourceMeta.capturedAt).toBe(Date.parse('2026-07-29T23:05:00Z'));
    });

    it('frontmatter 填入 type=reading + summary + knowledgePoints + 来源元数据', () => {
      const parsed = parseInboxFile(sampleContent)!;
      const input = toNoteInput(parsed);
      expect(input.frontmatter.type).toBe('reading');
      expect(input.frontmatter.sourceUrl).toBe('https://example.com/article/ai-knowledge-management');
      expect(input.frontmatter.author).toBe('张三');
      expect(input.frontmatter.summary).toContain('探讨如何用 AI');
      expect(input.frontmatter.knowledgePoints).toHaveLength(4);
    });

    it('publishedAt 转 number 毫秒', () => {
      const parsed = parseInboxFile(sampleContent)!;
      const input = toNoteInput(parsed);
      expect(input.frontmatter.publishedAt).toBe(Date.parse('2026-07-28T10:00:00Z'));
    });

    it('author / publishedAt 缺失时不报错', () => {
      const minimal = `---
id: min1
source: feishu-share
sourceUrl: https://example.com/x
capturedAt: 2026-07-29T23:05:00Z
title: 最小样例
tags: [t]
status: inbox
---

## 原文
正文`;
      const parsed = parseInboxFile(minimal)!;
      const input = toNoteInput(parsed);
      expect(input.frontmatter.author).toBeUndefined();
      expect(input.frontmatter.publishedAt).toBeUndefined();
    });
  });
});
