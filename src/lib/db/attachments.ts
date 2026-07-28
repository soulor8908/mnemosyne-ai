// 附件 DAO：图片/文件 Blob 存储在 IndexedDB
import { getDb } from './schema';
import { genId, now } from '@/lib/utils';
import type { Attachment } from '@/types';

const IMAGE_MIME_PREFIX = 'image/';

export function isImageMime(mime: string): boolean {
  return mime.startsWith(IMAGE_MIME_PREFIX);
}

// 保存附件，返回 Attachment（含 blob: URL 供前端使用）
export async function saveAttachment(
  noteId: string,
  file: File
): Promise<Attachment> {
  const db = getDb();
  const att: Attachment = {
    id: genId('att'),
    noteId,
    filename: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    blob: file,
    isImage: isImageMime(file.type),
    createdAt: now(),
  };
  await db.attachments.add(att);
  return att;
}

// 获取笔记的所有附件（不含 blob，仅元数据；blob 按需加载）
export async function listAttachmentsByNote(noteId: string): Promise<Attachment[]> {
  const db = getDb();
  return db.attachments.where('noteId').equals(noteId).toArray();
}

// 获取单个附件（含 blob）
export async function getAttachment(id: string): Promise<Attachment | undefined> {
  const db = getDb();
  return db.attachments.get(id);
}

// 生成 blob: URL（用于前端展示；调用方负责 revokeObjectURL）
export function getAttachmentUrl(att: Attachment): string {
  return URL.createObjectURL(att.blob);
}

// 删除单个附件
export async function deleteAttachment(id: string): Promise<void> {
  const db = getDb();
  await db.attachments.delete(id);
}

// attachment 协议正则：匹配 markdown 中 attachment://ID 的引用
// 支持 ![alt](attachment://ID) 和 [text](attachment://ID)
export const ATTACHMENT_URL_RE = /attachment:\/\/([a-zA-Z0-9_-]+)/g;

// 在笔记内容中插入附件引用（返回新内容）
// 使用 attachment://ID 协议持久化（blob URL 跨会话会失效）
// 图片用 ![](attachment://ID) 语法，文件用 [文件名](attachment://ID)
export function insertAttachmentRef(content: string, att: Attachment): string {
  const url = `attachment://${att.id}`;
  const ref = att.isImage
    ? `![${att.filename}](${url})`
    : `[📎 ${att.filename}](${url})`;
  // 如果内容为空或末尾没换行，先加换行
  if (!content) return ref;
  if (content.endsWith('\n')) return content + ref;
  return content + '\n' + ref;
}

// 将内容中的 attachment://ID 替换为实际的 blob URL（用于展示）
// attachmentsById: id -> Attachment 的映射
export function resolveAttachmentUrls(
  content: string,
  attachmentsById: Map<string, Attachment>,
  urlCache: Map<string, string> // id -> blob URL（避免重复创建）
): string {
  return content.replace(ATTACHMENT_URL_RE, (full, id: string) => {
    let url = urlCache.get(id);
    if (!url) {
      const att = attachmentsById.get(id);
      if (!att) return full; // 附件未找到，保留原引用
      url = URL.createObjectURL(att.blob);
      urlCache.set(id, url);
    }
    return url;
  });
}

// 撤销所有缓存的 blob URL（组件卸载时调用）
export function revokeUrlCache(urlCache: Map<string, string>): void {
  for (const url of urlCache.values()) {
    URL.revokeObjectURL(url);
  }
  urlCache.clear();
}
