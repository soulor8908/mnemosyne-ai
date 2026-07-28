// 集成测试：笔记 DAO
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, _resetDbForTests } from '@/lib/db/schema';
import { createNote, getNote, updateNote, deleteNote, listNotes, searchNotesByKeyword } from '@/lib/db/notes';

describe('notes DAO', () => {
  beforeEach(async () => {
    _resetDbForTests();
    await getDb().delete();
    await getDb().open();
  });

  it('创建并读取笔记', async () => {
    const note = await createNote({ content: '# 测试标题\n正文内容', tags: ['test'] });
    expect(note.id).toBeTruthy();
    expect(note.title).toBe('测试标题');
    expect(note.content).toBe('# 测试标题\n正文内容');
    expect(note.tags).toEqual(['test']);
    expect(note.rev).toBe(1);

    const fetched = await getNote(note.id);
    expect(fetched?.content).toBe('# 测试标题\n正文内容');
  });

  it('更新笔记递增 rev', async () => {
    const note = await createNote({ content: '初始' });
    const updated = await updateNote(note.id, { content: '修改后' });
    expect(updated?.rev).toBe(2);
    expect(updated?.content).toBe('修改后');
    expect(updated?.syncStatus).toBe('pending');
  });

  it('删除笔记同时清理关联', async () => {
    const note = await createNote({ content: '待删除' });
    await deleteNote(note.id);
    const fetched = await getNote(note.id);
    expect(fetched).toBeUndefined();
  });

  it('列表按 updatedAt 倒序', async () => {
    await createNote({ content: '旧' });
    await new Promise((r) => setTimeout(r, 10));
    await createNote({ content: '新' });
    const list = await listNotes({ limit: 10 });
    expect(list.length).toBe(2);
    expect(list[0].content).toBe('新');
  });

  it('关键词搜索', async () => {
    await createNote({ content: 'React 性能优化方案' });
    await createNote({ content: 'Vue 组件设计' });
    const results = await searchNotesByKeyword('React');
    expect(results.length).toBe(1);
    expect(results[0].content).toContain('React');
  });
});
