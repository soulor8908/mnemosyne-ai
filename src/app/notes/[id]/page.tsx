// 笔记编辑器：分栏 markdown 编辑 + 预览（移动端 tab 切换）
// 支持图片/文件上传：粘贴、拖拽、按钮三种方式
'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { updateNote, getNote, deleteNote } from '@/lib/db/notes';
import { embedNote } from '@/lib/ai/embed';
import { debounce } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import {
  saveAttachment,
  listAttachmentsByNote,
  insertAttachmentRef,
  resolveAttachmentUrls,
  revokeUrlCache,
} from '@/lib/db/attachments';
import type { Note, Attachment } from '@/types';

// 懒加载 Markdown 预览：react-markdown + remark-gfm + micromark 整套 ≈140KB，
// 只在实际渲染预览时作为独立 chunk 加载，不进入编辑器页 First Load JS。
const MarkdownPreview = dynamic(() => import('@/components/notes/markdown-preview'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-2 text-xs text-ink-400">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-300 border-t-accent" />
      加载预览…
    </div>
  ),
});

type MobileView = 'edit' | 'preview';

export default function NoteEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const noteId = params.id;

  const [note, setNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  // 桌面端：是否显示预览栏；移动端：当前 tab
  const [showPreview, setShowPreview] = useState(true);
  const [mobileView, setMobileView] = useState<MobileView>('edit');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState('');
  const embedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 附件缓存：id -> Attachment，以及 blob URL 缓存 id -> url
  const attachmentsRef = useRef<Map<string, Attachment>>(new Map());
  const urlCacheRef = useRef<Map<string, string>>(new Map());

  // 显示提示
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  // 加载笔记 + 附件
  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    (async () => {
      const n = await getNote(noteId);
      if (cancelled) return;
      if (n) {
        setNote(n);
        setContent(n.content);
        setTitle(n.title);
      }
      // 加载该笔记的所有附件（含 blob）
      try {
        const atts = await listAttachmentsByNote(noteId);
        if (cancelled) return;
        const map = new Map<string, Attachment>();
        for (const a of atts) map.set(a.id, a);
        attachmentsRef.current = map;
      } catch (e) {
        console.error('load attachments failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // 卸载时释放所有 blob URL
  useEffect(() => {
    return () => {
      revokeUrlCache(urlCacheRef.current);
    };
  }, []);

  // 防抖保存（保存的是原始 content，其中包含 attachment:// 引用）
  const debouncedSave = useCallback(
    debounce(async (id: string, newTitle: string, newContent: string) => {
      setSaving(true);
      try {
        await updateNote(id, { title: newTitle, content: newContent });
        setSavedAt(Date.now());
        if (embedTimerRef.current) clearTimeout(embedTimerRef.current);
        embedTimerRef.current = setTimeout(() => {
          embedNote(id, newContent).catch((e) => console.error('embed failed', e));
        }, 3000);
      } finally {
        setSaving(false);
      }
    }, 800),
    []
  );

  useEffect(() => {
    if (!note) return;
    debouncedSave(note.id, title, content);
  }, [title, content, note, debouncedSave]);

  // ============ 文件上传 ============
  async function uploadFiles(files: FileList | File[]) {
    if (!note) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      let newContent = content;
      for (const file of arr) {
        const att = await saveAttachment(note.id, file);
        attachmentsRef.current.set(att.id, att);
        newContent = insertAttachmentRef(newContent, att);
      }
      setContent(newContent);
      showToast(`已添加 ${arr.length} 个附件`);
    } catch (err) {
      showToast('上传失败：' + (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function handleUploadButtonClick() {
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      e.target.value = ''; // 允许重复选择同一文件
    }
  }

  // 粘贴：监听剪贴板中的图片和文件
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault(); // 阻止默认粘贴（避免把图片当作二进制乱码插入）
      uploadFiles(files);
    }
  }

  // 拖拽上传
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // 只在离开容器时清除
    if (e.currentTarget === e.target) {
      setDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  }

  async function handleDelete() {
    if (!note) return;
    if (!confirm('确认删除？此操作不可撤销。')) return;
    await deleteNote(note.id);
    router.push('/notes');
  }

  // 渲染时将 attachment://ID 替换为 blob URL
  const displayContent = useMemo(() => {
    return resolveAttachmentUrls(content, attachmentsRef.current, urlCacheRef.current);
  }, [content]);

  // 预览的图片/链接需要支持 blob: URL
  const markdownComponents = useMemo(
    () => ({
      a: ({ ...props }: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
    }),
    []
  );

  if (!note) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-400">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-300 border-t-accent" />
        <span className="text-sm">加载笔记…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex items-center justify-between gap-2 border-b border-ink-200 bg-white px-4 py-3 sm:px-6">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="无标题"
          className="min-w-0 flex-1 bg-transparent text-base font-medium text-ink-900 placeholder-ink-300 focus:outline-none sm:text-lg"
        />
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className="hidden text-xs text-ink-400 xs:inline sm:inline">
            {uploading
              ? '上传中…'
              : saving
              ? '保存中…'
              : savedAt
              ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN')}`
              : ''}
          </span>
          {/* 上传按钮 */}
          <button
            onClick={handleUploadButtonClick}
            disabled={uploading}
            className="flex items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-40"
            title="上传图片或文件"
          >
            <Icon name="image" size={14} />
            <Icon name="paperclip" size={14} />
            <span className="hidden sm:inline">上传</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            accept="image/*,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,application/json"
          />
          {/* 桌面端：显示/隐藏预览 */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="hidden items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50 lg:flex"
          >
            <Icon name={showPreview ? 'eye-off' : 'eye'} size={14} />
            {showPreview ? '隐藏预览' : '显示预览'}
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50"
          >
            <Icon name="trash" size={14} />
            <span className="hidden sm:inline">删除</span>
          </button>
        </div>
      </div>

      {/* 移动端 tab 切换 */}
      <div className="flex border-b border-ink-200 bg-white lg:hidden">
        <button
          onClick={() => setMobileView('edit')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-sm ${
            mobileView === 'edit'
              ? 'border-b-2 border-accent font-medium text-accent'
              : 'text-ink-500'
          }`}
        >
          <Icon name="edit" size={16} />
          编辑
        </button>
        <button
          onClick={() => setMobileView('preview')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-sm ${
            mobileView === 'preview'
              ? 'border-b-2 border-accent font-medium text-accent'
              : 'text-ink-500'
          }`}
        >
          <Icon name="eye" size={16} />
          预览
        </button>
      </div>

      {/* 编辑区 */}
      <div
        className={`relative flex flex-1 overflow-hidden ${
          dragOver ? 'ring-2 ring-inset ring-accent' : ''
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 编辑器：桌面端按 showPreview 决定宽度，移动端按 tab 决定显示 */}
        <div
          className={`flex flex-col ${
            showPreview ? 'lg:w-1/2 lg:flex' : 'lg:w-full lg:flex'
          } ${mobileView === 'edit' ? 'flex w-full' : 'hidden lg:flex'}`}
        >
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPaste={handlePaste}
            placeholder="开始写作…（支持 Markdown，可粘贴/拖拽图片和文件）"
            className="editor-textarea flex-1 resize-none bg-white px-4 py-4 font-mono text-sm leading-7 text-ink-800 placeholder-ink-300 focus:outline-none sm:px-6"
            spellCheck={false}
          />
        </div>
        {/* 预览：桌面端按 showPreview 决定，移动端按 tab 决定 */}
        <div
          className={`overflow-y-auto border-l border-ink-200 bg-ink-50 px-4 py-4 sm:px-6 ${
            showPreview ? 'lg:w-1/2 lg:block' : 'lg:hidden'
          } ${mobileView === 'preview' ? 'block w-full' : 'hidden lg:block'}`}
        >
          <div className="markdown-body">
            <MarkdownPreview
              content={displayContent}
              components={markdownComponents}
            />
          </div>
        </div>

        {/* 拖拽提示遮罩 */}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-accent/10">
            <div className="rounded-lg border-2 border-dashed border-accent bg-white/90 px-6 py-4 text-sm font-medium text-accent shadow-lg">
              <div className="flex items-center gap-2">
                <Icon name="upload" size={18} />
                释放以添加图片或文件
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
