// 设置页：MASTER_KEY 管理、BYOK、导出/导入、隐私模式
'use client';

import { useEffect, useState } from 'react';
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
} from '@/lib/markdown/export';
import type { ReviewPreset } from '@/types';

export default function SettingsPage() {
  const [masterKey, setMasterKeyState] = useState<string>('');
  const [inputKey, setInputKey] = useState('');
  const [byokProvider, setByokProvider] = useState<'deepseek' | 'glm' | 'openai'>('deepseek');
  const [byokApiKey, setByokApiKey] = useState('');
  const [byokSaved, setByokSaved] = useState<Record<string, boolean>>({});
  const [fsrsPreset, setFsrsPresetState] = useState<ReviewPreset>('standard');
  const [privacyMode, setPrivacyModeState] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');

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
    // 检查已存的 BYOK
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
    setMessage('MASTER_KEY 已复制到剪贴板，请妥善保存');
    setTimeout(() => setMessage(''), 3000);
  }

  async function handleRestoreKey() {
    if (!inputKey.trim()) return;
    try {
      await setMasterKey(inputKey.trim());
      setMasterKeyState(inputKey.trim());
      setInputKey('');
      setMessage('MASTER_KEY 已恢复');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage('恢复失败：' + (err as Error).message);
    }
  }

  async function handleSaveByok() {
    if (!byokApiKey.trim()) return;
    await saveByokKey(byokProvider, byokApiKey.trim());
    setByokApiKey('');
    setByokSaved((prev) => ({ ...prev, [byokProvider]: true }));
    setMessage(`${byokProvider} API Key 已加密保存`);
    setTimeout(() => setMessage(''), 3000);
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

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const count = await importFromMarkdownFiles(Array.from(files));
      setMessage(`已导入 ${count} 篇笔记`);
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-ink-900">设置</h1>

      {message && (
        <div className="mb-4 rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm text-accent">
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
                <code className="flex-1 truncate rounded bg-ink-100 px-3 py-1.5 text-xs text-ink-700">
                  {masterKey}
                </code>
                <button
                  onClick={copyMasterKey}
                  className="rounded-md border border-ink-200 px-3 py-1.5 text-xs text-ink-600 hover:bg-ink-50"
                >
                  复制
                </button>
              </div>
              <p className="mt-2 text-xs text-red-500">
                ⚠ 请立即保存此密钥到安全位置。清浏览器数据后将无法找回。
              </p>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="粘贴已保存的 MASTER_KEY"
                className="flex-1 rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
              <button
                onClick={handleRestoreKey}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
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
          <div className="flex gap-2">
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
              className="flex-1 rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <button
              onClick={handleSaveByok}
              disabled={!byokApiKey.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              保存
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            {(['deepseek', 'glm', 'openai'] as const).map((p) => (
              <span
                key={p}
                className={`rounded px-2 py-0.5 text-xs ${
                  byokSaved[p] ? 'bg-green-100 text-green-700' : 'bg-ink-100 text-ink-400'
                }`}
              >
                {p} {byokSaved[p] ? '✓' : '○'}
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
            className="rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
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
            <span className="text-sm text-ink-600">
              隐私模式（嵌入生成在本地，不上 Workers AI）
            </span>
            <input
              type="checkbox"
              checked={privacyMode}
              onChange={async (e) => {
                await setPrivacyMode(e.target.checked);
                setPrivacyModeState(e.target.checked);
              }}
              className="h-4 w-4"
            />
          </label>
        </div>
      </section>

      {/* 导出/导入 */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-ink-900">数据导出 / 导入</h2>
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <p className="mb-3 text-sm text-ink-600">
            你的数据永远是你的。一键导出全部笔记，或从 Markdown 文件导入。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExportJson}
              disabled={exporting}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              {exporting ? '导出中…' : '导出 JSON 备份'}
            </button>
            <button
              onClick={handleExportMd}
              disabled={exporting}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
            >
              导出 Markdown
            </button>
            <label className="cursor-pointer rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50">
              {importing ? '导入中…' : '从 Markdown 导入'}
              <input
                type="file"
                accept=".md,.markdown"
                multiple
                onChange={handleImport}
                className="hidden"
              />
            </label>
          </div>
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
