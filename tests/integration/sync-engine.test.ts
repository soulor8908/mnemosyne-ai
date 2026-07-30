// 集成测试：同步引擎（上传 / 下载 / 冲突字段级合并 + 本地快照）
// 用内存 KV 模拟 Cloudflare KV，用 fake-indexeddb 模拟本地 Dexie
import { describe, it, expect, beforeEach } from 'vitest';
import { syncNoteUp, syncAllUp, syncDown, fullSync } from '@/lib/sync/engine';
import { getDb, _resetDbForTests } from '@/lib/db/schema';
import { ensureMasterKey, getCryptoKey } from '@/lib/auth/user-prefs';
import { encryptJSON } from '@/lib/crypto';
import type { Note } from '@/types';
// Env 在 session.ts 中是局部 interface（未导出）；这里用最小对象 + 类型断言绕过，
// 运行时只用到 KV / NOTES_DELTA 两个字段。
import type { Env } from '@/lib/auth/session';

class InMemoryKV {
  private store = new Map<string, { value: string; metadata?: unknown }>();
  async get(key: string, options?: { type?: 'json' | 'text' }): Promise<any> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (options?.type === 'json') return JSON.parse(entry.value);
    return entry.value;
  }
  async put(
    key: string,
    value: string,
    _options?: { expirationTtl?: number; metadata?: unknown }
  ): Promise<void> {
    this.store.set(key, { value, metadata: _options?.metadata });
  }
  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string; metadata?: unknown }> }> {
    const keys = [...this.store.keys()]
      .filter((k) => !options?.prefix || k.startsWith(options.prefix))
      .map((name) => ({ name, metadata: this.store.get(name)!.metadata }));
    return { keys };
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeNote(over: Partial<Note> & { id: string }): Note {
  const ts = 1_000;
  return {
    title: over.title ?? '默认标题',
    content: over.content ?? '',
    frontmatter: {},
    folderId: null,
    tags: over.tags ?? [],
    status: over.status ?? 'draft',
    source: 'manual',
    createdAt: ts,
    updatedAt: over.updatedAt ?? ts,
    accessedAt: ts,
    rev: over.rev ?? 1,
    syncStatus: over.syncStatus ?? 'local',
    encryption: 'plain',
    ...over,
  };
}

function fakeEnv(kv: InMemoryKV): Env {
  return { KV: kv, NOTES_DELTA: kv } as unknown as Env;
}

describe('sync engine', () => {
  let kv: InMemoryKV;
  let env: Env;

  beforeEach(async () => {
    _resetDbForTests();
    getDb(); // 触发初始化
    await ensureMasterKey(); // 初始化内存密钥缓存
    kv = new InMemoryKV();
    env = fakeEnv(kv);
  });

  it('syncAllUp：pending 笔记加密上传到 KV 并标记 synced', async () => {
    const db = getDb();
    await db.notes.add(makeNote({ id: 'n_up', syncStatus: 'pending', content: '内容A', tags: ['t1'] }));

    const res = await syncAllUp(env, 'u1');
    expect(res.synced).toBe(1);
    expect(res.failed).toBe(0);

    // KV 写入了 meta 与 delta
    const meta = await kv.get('u:u1:meta:n_up');
    const delta = await kv.get('u:u1:delta:n_up:1');
    expect(meta).toBeTruthy();
    expect(delta).toBeTruthy();

    // 本地状态变为 synced
    const after = await db.notes.get('n_up');
    expect(after!.syncStatus).toBe('synced');
  });

  it('syncDown：远程更新（rev 更高）覆盖本地内容 + tags 并集', async () => {
    const db = getDb();
    const key = await getCryptoKey();
    const noteId = 'n_pull';
    const T1 = 1000;
    const T2 = 2000;

    // 模拟另一台设备上传的 delta（rev=2）
    const contentCipher = await encryptJSON({ content: '远程内容' }, key!);
    const meta = await encryptJSON(
      {
        title: 'R标题',
        tags: ['x'],
        status: 'settled',
        folderId: null,
        frontmatter: {},
        source: 'manual',
        sourceMeta: undefined,
        encryption: 'plain',
        createdAt: T1,
        updatedAt: T2,
        accessedAt: T2,
      },
      key!
    );
    const delta = { noteId, rev: 2, contentCipher, meta, updatedAt: T2 };
    await kv.put(`u:u1:delta:${noteId}:2`, JSON.stringify(delta), { expirationTtl: 30 * 24 * 3600 });

    // 本地是旧版（rev=1，已同步）
    await db.notes.add(makeNote({ id: noteId, rev: 1, syncStatus: 'synced', content: '本地旧内容', tags: ['y'] }));

    const r = await syncDown(env, 'u1', 0);
    expect(r.pulled).toBe(1);
    expect(r.conflicts).toBe(0);

    const pulled = await db.notes.get(noteId);
    expect(pulled!.content).toBe('远程内容'); // 远程优先
    expect(pulled!.tags).toEqual(expect.arrayContaining(['x', 'y'])); // 并集
    expect(pulled!.rev).toBe(2);
    expect(pulled!.syncStatus).toBe('synced');
  });

  it('syncDown：本地有未提交编辑（pending）遇远程更新 → 快照保存 + 标记 conflict', async () => {
    const db = getDb();
    const key = await getCryptoKey();
    const noteId = 'n_conflict';
    const T1 = 1000;
    const T2 = 5000;

    const contentCipher = await encryptJSON({ content: '远程内容' }, key!);
    const meta = await encryptJSON(
      {
        title: 'R标题',
        tags: ['x'],
        status: 'settled',
        folderId: null,
        frontmatter: {},
        source: 'manual',
        sourceMeta: undefined,
        encryption: 'plain',
        createdAt: T1,
        updatedAt: T2,
        accessedAt: T2,
      },
      key!
    );
    const delta = { noteId, rev: 2, contentCipher, meta, updatedAt: T2 };
    await kv.put(`u:u1:delta:${noteId}:2`, JSON.stringify(delta), { expirationTtl: 30 * 24 * 3600 });

    // 本地有未提交编辑（rev=1，syncStatus=pending）
    await db.notes.add(makeNote({ id: noteId, rev: 1, syncStatus: 'pending', content: '本地编辑', tags: ['y'], updatedAt: T1 }));

    const r = await syncDown(env, 'u1', 0);
    expect(r.pulled).toBe(1);
    expect(r.conflicts).toBe(1);

    const merged = await db.notes.get(noteId);
    expect(merged!.syncStatus).toBe('conflict'); // 用户可感知
    expect(merged!.content).toBe('远程内容'); // 远程优先
    expect(merged!.tags).toEqual(expect.arrayContaining(['x', 'y'])); // 并集
    expect(merged!.rev).toBe(2);

    // 本地编辑被存进快照，不丢失
    const snaps = await db.snapshots.where('noteId').equals(noteId).toArray();
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    expect(snaps[0].content).toBe('本地编辑');
  });

  it('fullSync：先拉后推，结构正确不抛错', async () => {
    const db = getDb();
    await db.notes.add(makeNote({ id: 'n_full', syncStatus: 'pending', content: 'z', tags: [] }));
    const r = await fullSync(env, 'u1');
    expect(r.downloaded).toBeDefined();
    expect(r.uploaded.synced).toBeGreaterThanOrEqual(1);
  });
});
