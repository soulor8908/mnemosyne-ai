// 集成测试：inbox 导入器（飞书捕获通道 → Mnemosyne 本地库）
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getDb, _resetDbForTests } from '@/lib/db/schema';
import { ingestInboxFiles } from '@/lib/inbox/ingest';

const samplePath = resolve(__dirname, '../fixtures/inbox-sample.md');
const sampleContent = readFileSync(samplePath, 'utf-8');

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/markdown' });
}

describe('inbox ingest 导入器', () => {
  beforeEach(async () => {
    _resetDbForTests();
    await getDb().delete();
    await getDb().open();
  });

  it('单个 inbox 文件导入成功，source=feishu，sourceMeta 含飞书回溯字段', async () => {
    const file = makeFile('2026-07-29_inbox_abc.md', sampleContent);
    const result = await ingestInboxFiles([file]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    const notes = await getDb().notes.toArray();
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.source).toBe('feishu');
    expect(note.id).toBe('inbox_abc123def456');
    expect(note.title).toBe('AI 时代的知识管理：从收集到内化');
    expect(note.tags).toEqual(['AI', '知识管理', '笔记']);
    expect(note.sourceMeta?.url).toBe('https://example.com/article/ai-knowledge-management');
    expect(note.sourceMeta?.feishuChatId).toBe('oc_sample_chat');
    expect(note.sourceMeta?.feishuMessageId).toBe('om_sample_msg');
    expect(note.frontmatter.type).toBe('reading');
    expect(note.frontmatter.summary).toContain('探讨如何用 AI');
    expect(note.frontmatter.knowledgePoints).toHaveLength(4);
    expect(note.status).toBe('draft');
    expect(note.syncStatus).toBe('local');
  });

  it('相同 sourceUrl 重复导入 → 跳过去重', async () => {
    const file = makeFile('2026-07-29_x.md', sampleContent);
    const r1 = await ingestInboxFiles([file]);
    expect(r1.imported).toBe(1);

    const r2 = await ingestInboxFiles([file]);
    expect(r2.imported).toBe(0);
    expect(r2.skipped).toBe(1);

    const notes = await getDb().notes.toArray();
    expect(notes).toHaveLength(1);
  });

  it('status=inbox-raw 的文件 → 跳过不导入（等 Trae 重试）', async () => {
    const rawContent = sampleContent.replace('status: inbox', 'status: inbox-raw');
    const file = makeFile('raw.md', rawContent);
    const result = await ingestInboxFiles([file]);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    const notes = await getDb().notes.toArray();
    expect(notes).toHaveLength(0);
  });

  it('status=ingested 的文件 → 跳过', async () => {
    const done = sampleContent.replace('status: inbox', 'status: ingested');
    const file = makeFile('done.md', done);
    const result = await ingestInboxFiles([file]);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('无 frontmatter 的文件 → 记 error，不阻断后续文件', async () => {
    const bad = makeFile('bad.md', '纯正文没有 frontmatter');
    const good = makeFile('good.md', sampleContent);
    const result = await ingestInboxFiles([bad, good]);

    expect(result.imported).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('bad.md');
    const notes = await getDb().notes.toArray();
    expect(notes).toHaveLength(1);
  });

  it('批量导入多个不同 URL 的文件', async () => {
    const f1 = makeFile('a.md', sampleContent);
    const f2 = makeFile(
      'b.md',
      sampleContent
        .replace('inbox_abc123def456', 'inbox_xyz789')
        .replace('example.com/article/ai-knowledge-management', 'example.com/another')
    );
    const result = await ingestInboxFiles([f1, f2]);
    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(0);
    const notes = await getDb().notes.toArray();
    expect(notes).toHaveLength(2);
  });
});
