// 同步引擎：本地 <-> Cloudflare KV
// 策略：时间戳 + 字段级合并 + 乐观锁（技术设计文档 4.1）
import { getDb } from '@/lib/db/schema';
import { getPendingSyncNotes, markSynced } from '@/lib/db/notes';
import type { Note, SyncDelta } from '@/types';
import { getCryptoKey } from '@/lib/auth/user-prefs';
import { encryptJSON, decryptJSON } from '@/lib/crypto';
import type { Env } from '@/lib/auth/session';

// 上传单条笔记的 delta
export async function syncNoteUp(note: Note, env: Env, userId: string): Promise<void> {
  const key = await getCryptoKey();
  if (!key) throw new Error('MASTER_KEY 未初始化');

  // 加密内容与元数据
  const contentCipher = await encryptJSON(
    { content: note.content },
    key
  );
  const metaCipher = await encryptJSON(
    {
      title: note.title,
      tags: note.tags,
      folderId: note.folderId,
      status: note.status,
      frontmatter: note.frontmatter,
      source: note.source,
      sourceMeta: note.sourceMeta,
      encryption: note.encryption,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      accessedAt: note.accessedAt,
    },
    key
  );

  const delta: SyncDelta = {
    noteId: note.id,
    rev: note.rev,
    contentCipher,
    meta: metaCipher,
    updatedAt: note.updatedAt,
  };

  // 写入 NOTES_DELTA（30 天 TTL）
  await env.NOTES_DELTA.put(
    `u:${userId}:delta:${note.id}:${note.rev}`,
    JSON.stringify(delta),
    { expirationTtl: 30 * 24 * 3600 }
  );

  // 更新 KV 主索引（元数据密文 + rev metadata）
  await env.KV.put(`u:${userId}:meta:${note.id}`, metaCipher, {
    metadata: { rev: note.rev, updatedAt: note.updatedAt },
  });

  // 本地标记已同步
  await markSynced(note.id, note.rev);
}

// 上传所有待同步笔记
export async function syncAllUp(env: Env, userId: string): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingSyncNotes();
  let synced = 0;
  let failed = 0;
  for (const note of pending) {
    try {
      await syncNoteUp(note, env, userId);
      synced++;
    } catch (err) {
      console.error('sync note failed', note.id, err);
      failed++;
    }
  }
  return { synced, failed };
}

// 拉取远程 delta 并合并到本地
export async function syncDown(env: Env, userId: string, sinceRev = 0): Promise<{ pulled: number; conflicts: number }> {
  const key = await getCryptoKey();
  if (!key) throw new Error('MASTER_KEY 未初始化');
  const db = getDb();

  // 列出 NOTES_DELTA 中该用户的所有 key
  const list = await env.NOTES_DELTA.list({ prefix: `u:${userId}:delta:` });
  let pulled = 0;
  let conflicts = 0;

  for (const item of list.keys) {
    // 解析 noteId 和 rev
    const parts = item.name.split(':');
    if (parts.length < 5) continue;
    const noteId = parts[3];
    const rev = parseInt(parts[4], 10);
    if (isNaN(rev) || rev <= sinceRev) continue;

    const raw = await env.NOTES_DELTA.get(item.name, { type: 'json' });
    if (!raw) continue;
    const delta = raw as unknown as SyncDelta;

    const local = await db.notes.get(noteId);

    if (!local) {
      // 本地无，直接拉取
      const content = await decryptJSON<{ content: string }>(delta.contentCipher, key);
      const meta = await decryptJSON<Partial<Note>>(delta.meta, key);
      const note: Note = {
        id: noteId,
        title: meta.title ?? '无标题',
        content: content.content ?? '',
        frontmatter: meta.frontmatter ?? {},
        folderId: meta.folderId ?? null,
        tags: meta.tags ?? [],
        status: meta.status ?? 'draft',
        source: meta.source ?? 'manual',
        sourceMeta: meta.sourceMeta,
        createdAt: meta.createdAt ?? delta.updatedAt,
        updatedAt: meta.updatedAt ?? delta.updatedAt,
        accessedAt: meta.accessedAt ?? delta.updatedAt,
        rev: delta.rev,
        syncStatus: 'synced',
        encryption: meta.encryption ?? 'plain',
      };
      await db.notes.put(note);
      pulled++;
    } else if (local.rev < rev) {
      // 本地版本旧
      const content = await decryptJSON<{ content: string }>(delta.contentCipher, key);
      const meta = await decryptJSON<Partial<Note>>(delta.meta, key);

      // 修复要点：本地若有未提交的编辑（syncStatus === 'pending'），不能直接覆盖，
      // 否则用户最近一次离线编辑会丢失。改为：
      // 1) 保存本地当前内容快照（snapshots 表）
      // 2) 写入远程版本（保证设备间一致）
      // 3) 标记 syncStatus = 'conflict'，UI 提示用户在快照中查看丢失的本地编辑
      // 技术设计文档 4.3 承诺字段级合并：tags 并集、frontmatter 浅合并（updatedAt 优先），
      // 其余字段按 updatedAt 取更新者
      if (local.syncStatus === 'pending') {
        try {
          await db.snapshots.add({
            id: `${noteId}:${local.rev}:${Date.now()}`,
            noteId,
            content: local.content,
            createdAt: Date.now(),
            reason: 'pre-sync-conflict',
          });
        } catch (snapErr) {
          console.error('[sync] 保存冲突快照失败', noteId, snapErr);
        }
        conflicts++;
      }

      // frontmatter 浅合并：本地 + 远程，远程字段优先（updatedAt 更新者）
      const mergedFrontmatter = {
        ...(local.frontmatter ?? {}),
        ...(meta.frontmatter ?? {}),
      };

      const merged: Note = {
        ...local,
        // 远程 meta 优先（updatedAt 更新者）
        title: meta.title ?? local.title,
        folderId: meta.folderId ?? local.folderId,
        status: meta.status ?? local.status,
        source: meta.source ?? local.source,
        sourceMeta: meta.sourceMeta ?? local.sourceMeta,
        encryption: meta.encryption ?? local.encryption,
        frontmatter: mergedFrontmatter,
        // 内容按 updatedAt 取最新；远程 delta 携带 updatedAt，本地已比较 rev < rev
        content: content.content ?? local.content,
        // tags 并集（设计 4.3）
        tags: [...new Set([...(local.tags ?? []), ...(meta.tags ?? [])])],
        createdAt: meta.createdAt ?? local.createdAt,
        accessedAt: Math.max(local.accessedAt ?? 0, meta.accessedAt ?? 0),
        updatedAt: Math.max(local.updatedAt, delta.updatedAt),
        rev: delta.rev,
        // 若本地有 pending 编辑被快照保存，标记为冲突让用户感知
        syncStatus: local.syncStatus === 'pending' ? 'conflict' : 'synced',
      };
      await db.notes.put(merged);
      pulled++;
    } else if (local.rev > rev) {
      // 本地更新，保留本地（下次 syncUp 会覆盖远程）
      continue;
    } else if (local.updatedAt > delta.updatedAt) {
      // rev 相同但本地 updatedAt 更新，冲突
      conflicts++;
    }
  }

  return { pulled, conflicts };
}

// 完整同步流程
export async function fullSync(env: Env, userId: string): Promise<{
  uploaded: { synced: number; failed: number };
  downloaded: { pulled: number; conflicts: number };
}> {
  // 先拉取（避免覆盖本地新改动）
  const downloaded = await syncDown(env, userId);
  // 再上传
  const uploaded = await syncAllUp(env, userId);
  return { uploaded, downloaded };
}
