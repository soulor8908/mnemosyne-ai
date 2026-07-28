// 设置页：MASTER_KEY 管理、BYOK、导出/导入、隐私模式
'use client';

import { useEffect, useState, useRef } from 'react';
import {
  getOrCreateUserPrefs,
  initMasterKey,
  setMasterKey,
  saveByokKey,
  getDecryptedByokKey,
  setFsrsPreset,
  setPrivacyMode,
} from '@/lib/auth/user-prefs';
import {
  exportAsJson,
  exportAsMarkdownBundle,
  importFromMarkdownFiles,
  importFromJson,
  importFromHtmlFiles,
  type ImportResult,
} from '@/lib/markdown/export';
import { Icon } from '@/components/ui/icon';
import type { ReviewPreset } from '@/types';

export default function SettingsPage() {
  const [masterKey, setMasterKeyState] = useState<string>('');
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [byokProvider, setByokProvider] = useState<'deepseek' | 'glm' | 'openai'>('deepseek');
  const [byokApiKey, setByokApiKey] = useState('');
  const [byokSaved, setByokSaved] = useState<Record<string, boolean>>({});
  const [fsrsPreset, setFsrsPresetState] = useState<ReviewPreset>('standard');
  const [privacyMode, setPrivacyModeState] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const mdInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    try {
      const mk = await initMasterKey();
      setMasterKeyState(mk);
    } catch {
      // 已存在但未缓存，需要用户输入
    }
    const prefs = await getOrCreateUserPrefs();
    setFsrsPresetState(prefs.fsrsPreset);
    setPrivacyModeState(prefs.privacyMode);
    const saved: Record<string, boolean> = {};
    for (const p of ['deepseek', 'glm', 'openai']) {
      const key = await getDecryptedByokKey(p);
      if (key) saved[p] = true;
    }
    setByokSaved(saved);
  }

  function copyMasterKey() {
    if (!masterKey) return;
    navigator.clipboard.writeText(masterKey);
    showToast('MASTER_KEY 已复制到剪贴板，请妥善保存');
  }

  function showToast(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3500);
  }

  async function handleRestoreKey() {
    if (!inputKey.trim()) return;
    try {
      await setMasterKey(inputKey.trim());
      setMasterKeyState(inputKey.trim());
      setInputKey('');
      showToast('MASTER_KEY 已恢复');
    } catch (err) {
      showToast('恢复失败：' + (err as Error).message);
    }
  }

  async function handleSaveByok() {
    if (!byokApiKey.trim()) return;
    await saveByokKey(byokProvider, byokApiKey.trim());
    setByokApiKey('');
    setByokSaved((prev) => ({ ...prev, [byokProvider]: true }));
    showToast(`${byokProvider} API Key 已加密保存`);
  }

  async function handleExportJson() {
    setExporting(true);
    try {
      const blob = await exportAsJson();
      downloadBlob(blob, `mnemosyne-backup-${Date.now()}.json`);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportMd() {
    setExporting(true);
    try {
      const blob = await exportAsMarkdownBundle();
      downloadBlob(blob, `mnemosyne-notes-${Date.now()}.md`);
    } finally {
      setExporting(false);
    }
  }

  async function handleImportMd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const result = await importFromMarkdownFiles(Array.from(files));
      showImportResult('Markdown', result);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  async function handleImportJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await importFromJson(file);
      showImportResult('JSON', result);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  async function handleImportHtml(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const result = await importFromHtmlFiles(Array.from(files));
      showImportResult('HTML', result);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  function showImportResult(source: string, result: ImportResult) {
    const parts: string[] = [`从 ${source} 导入完成：成功 ${result.imported} 篇`];
    if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 项`);
    if (result.errors.length > 0) {
      parts.push(`错误 ${result.errors.length} 个：${result.errors.slice(0, 2).join('；')}${result.errors.length > 2 ? '…' : ''}`);
    }
    showToast(parts.join('，'));
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="mb-6 text-xl font-semibold text-ink-900 sm:text-2xl">设置</h1>

      {message && (
        <div className="mb-4 rounded-lg border border-accent bg-accent/10 px-4 py-2.5 text-sm text-accent">
          {message}
        </div>
      )}

      {/* MASTER_KEY */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-ink-900">数据主权</h2>
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <p className="mb-3 text-sm text-ink-600">
            MASTER_KEY 是你的数据加密密钥。服务端只存储它的哈希，密钥本身只存在你的浏览器。
            换设备时需要用此密钥恢复数据访问。
          </p>
          {masterKey ? (
            <div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-ink-100 px-3 py-1.5 text-xs text-ink-700">
                  {showKey ? masterKey : '••••••••••••••••••••••••••••••••'}
                </code>
                <button
                  onClick={() => setShowKey((v) => !v)}
                  className="shrink-0 rounded-md border border-ink-200 p-1.5 text-ink-600 hover:bg-ink-50"
                  aria-label={showKey ? '隐藏' : '显示'}
                >
                  <Icon name={showKey ? 'eye-off' : 'eye'} size={16} />
                </button>
                <button
                  onClick={copyMasterKey}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs text-ink-600 hover:bg-ink-50"
                >
                  <Icon name="copy" size={14} />
                  <span className="hidden sm:inline">复制</span>
                </button>
              </div>
              <p className="mt-2 flex items-center gap-1 text-xs text-red-500">
                <Icon name="sparkles" size={12} />
                请立即保存此密钥到安全位置。清浏览器数据后将无法找回。
              </p>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="粘贴已保存的 MASTER_KEY"
                className="min-w-0 flex-1 rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
              <button
                onClick={handleRestoreKey}
                className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
              >
                恢复
              </button>
            </div>
          )}
        </div>
      </section>

      {/* AI BYOK */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-ink-900">AI 配置（自带 Key）</h2>
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <p className="mb-3 text-sm text-ink-600">
            填入你自己的 API Key，AI 调用成本由你直接承担，平台不抽成。Key 会用 MASTER_KEY 加密存储。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={byokProvider}
              onChange={(e) => setByokProvider(e.target.value as any)}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="deepseek">DeepSeek</option>
              <option value="glm">智谱 GLM</option>
              <option value="openai">OpenAI</option>
            </select>
            <input
              type="password"
              value={byokApiKey}
              onChange={(e) => setByokApiKey(e.target.value)}
              placeholder={`API Key${byokSaved[byokProvider] ? '（已设置，输入新值覆盖）' : ''}`}
              className="min-w-0 flex-1 rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <button
              onClick={handleSaveByok}
              disabled={!byokApiKey.trim()}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              保存
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['deepseek', 'glm', 'openai'] as const).map((p) => (
              <span
                key={p}
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                  byokSaved[p] ? 'bg-green-100 text-green-700' : 'bg-ink-100 text-ink-400'
                }`}
              >
                {p}
                <Icon name={byokSaved[p] ? 'check' : 'close'} size={12} />
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 复习偏好 */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-ink-900">复习偏好</h2>
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <label className="mb-2 block text-sm text-ink-600">FSRS 预设</label>
          <select
            value={fsrsPreset}
            onChange={async (e) => {
              const v = e.target.value as ReviewPreset;
              await setFsrsPreset(v);
              setFsrsPresetState(v);
            }}
            className="w-full rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-accent focus:outline-none sm:w-auto"
          >
            <option value="conservative">保守（记忆保持率 95%）</option>
            <option value="standard">标准（记忆保持率 90%）</option>
            <option value="aggressive">激进（记忆保持率 80%，复习更少）</option>
          </select>
        </div>
      </section>

      {/* 隐私 */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-ink-900">隐私</h2>
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <label className="flex items-center justify-between">
            <span className="pr-3 text-sm text-ink-600">
              隐私模式（嵌入生成在本地，不上 Workers AI）
            </span>
            <input
              type="checkbox"
              checked={privacyMode}
              onChange={async (e) => {
                await setPrivacyMode(e.target.checked);
                setPrivacyModeState(e.target.checked);
              }}
              className="h-4 w-4 shrink-0 accent-accent"
            />
          </label>
        </div>
      </section>

      {/* 导出 */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-ink-900">数据导出</h2>
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <p className="mb-3 text-sm text-ink-600">
            一键导出全部笔记、文件夹、双链和复习卡。JSON 备份可完整恢复；Markdown 便于迁移到其他工具。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExportJson}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              <Icon name="json" size={15} />
              {exporting ? '导出中…' : '导出 JSON 备份'}
            </button>
            <button
              onClick={handleExportMd}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              <Icon name="markdown" size={15} />
              导出 Markdown
            </button>
          </div>
        </div>
      </section>

      {/* 导入 */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-ink-900">数据导入</h2>
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <p className="mb-3 text-sm text-ink-600">
            从其他笔记应用迁移数据。支持 Mnemosyne JSON 备份、Markdown 文件、HTML 文件（印象笔记 / Notion 导出）。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => jsonInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              <Icon name="json" size={15} />
              JSON 备份
              <input
                ref={jsonInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportJson}
                className="hidden"
              />
            </button>
            <button
              onClick={() => mdInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              <Icon name="markdown" size={15} />
              Markdown
              <input
                ref={mdInputRef}
                type="file"
                accept=".md,.markdown,.txt"
                multiple
                onChange={handleImportMd}
                className="hidden"
              />
            </button>
            <button
              onClick={() => htmlInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              <Icon name="html" size={15} />
              HTML（印象笔记/Notion）
              <input
                ref={htmlInputRef}
                type="file"
                accept=".html,.htm,text/html"
                multiple
                onChange={handleImportHtml}
                className="hidden"
              />
            </button>
          </div>
          {importing && (
            <p className="mt-2 flex items-center gap-1 text-xs text-accent">
              <Icon name="upload" size={12} />
              导入中…
            </p>
          )}
        </div>
      </section>

      <p className="text-center text-xs text-ink-300">
        Mnemosyne · 你的笔记永远是你的 · 本地优先 · 加密同步
      </p>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
