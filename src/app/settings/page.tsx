// 设置页：BYOK、导出/导入、隐私模式、高级（助记词管理）
'use client';

import { useEffect, useState, useRef } from 'react';
import {
  getOrCreateUserPrefs,
  ensureMasterKey,
  getCachedMnemonic,
  restoreFromMnemonic,
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
import { ingestInboxFiles } from '@/lib/inbox/ingest';
import { getSyncToken, setSyncToken } from '@/lib/api/client';
import { downloadBlob } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import type { ReviewPreset } from '@/types';

export default function SettingsPage() {
  const [mnemonic, setMnemonicState] = useState<string>('');
  const [inputMnemonic, setInputMnemonic] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [syncTokenInput, setSyncTokenInput] = useState('');
  const [syncTokenSaved, setSyncTokenSaved] = useState(false);
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
  const inboxInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    // 体验路径：不主动生成 MASTER_KEY。
    // 仅当用户之前已生成过（内存缓存仍在）时回填助记词到 UI。
    const cached = getCachedMnemonic();
    if (cached) setMnemonicState(cached);

    // 回填访问令牌状态（不回显明文）
    setSyncTokenSaved(!!getSyncToken());

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

  function copyMnemonic() {
    if (!mnemonic) return;
    navigator.clipboard.writeText(mnemonic);
    showToast('恢复短语已复制，请妥善保存');
  }

  function showToast(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3500);
  }

  async function handleRestoreFromMnemonic() {
    if (!inputMnemonic.trim()) return;
    try {
      await restoreFromMnemonic(inputMnemonic.trim());
      setMnemonicState(inputMnemonic.trim().toLowerCase());
      setInputMnemonic('');
      showToast('已从恢复短语解锁本设备数据');
    } catch (err) {
      showToast('恢复失败：' + (err as Error).message);
    }
  }

  async function handleRevealMnemonic() {
    // 用户主动点「显示恢复短语」才生成（若未生成）或展示
    try {
      const { mnemonic: m } = await ensureMasterKey();
      setMnemonicState(m);
      setShowMnemonic(true);
    } catch (err) {
      showToast('生成失败：' + (err as Error).message);
    }
  }

  async function handleSaveByok() {
    if (!byokApiKey.trim()) return;
    await saveByokKey(byokProvider, byokApiKey.trim());
    setByokApiKey('');
    setByokSaved((prev) => ({ ...prev, [byokProvider]: true }));
    showToast(`${byokProvider} API Key 已加密保存`);
  }

  function handleSaveSyncToken() {
    if (!syncTokenInput.trim()) return;
    setSyncToken(syncTokenInput.trim());
    setSyncTokenInput('');
    setSyncTokenSaved(true);
    showToast('访问令牌已保存到本设备');
  }

  function handleClearSyncToken() {
    setSyncToken('');
    setSyncTokenSaved(false);
    showToast('访问令牌已清除');
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

  async function handleImportInbox(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const result = await ingestInboxFiles(Array.from(files));
      showImportResult('飞书 inbox', result);
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

      {/* 高级：数据主权（默认折叠，体验用户无需关注） */}
      <section className="mb-8">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-ink-200 bg-white px-4 py-3 text-left hover:bg-ink-50"
        >
          <span className="text-sm font-medium text-ink-700">高级 · 数据主权与恢复短语</span>
          <Icon name={advancedOpen ? 'chevron-up' : 'chevron-down'} size={16} className="text-ink-400" />
        </button>
        {advancedOpen && (
          <div className="mt-2 rounded-lg border border-ink-200 bg-white p-4">
            <p className="mb-3 text-sm text-ink-600">
              你的 BYOK Key 与同步笔记会用一组 12 词的「恢复短语」加密。
              服务端只存储密钥的哈希，短语本身只存在你的浏览器内存中。
              换设备或清浏览器数据后，凭这 12 个词即可恢复数据访问。
            </p>

            {mnemonic ? (
              <div>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 rounded bg-ink-100 px-3 py-2 text-xs leading-relaxed text-ink-700 break-words">
                    {showMnemonic ? mnemonic : '••• ••• ••• ••• ••• ••• ••• ••• ••• ••• ••• •••'}
                  </code>
                  <button
                    onClick={() => setShowMnemonic((v) => !v)}
                    className="shrink-0 rounded-md border border-ink-200 p-1.5 text-ink-600 hover:bg-ink-50"
                    aria-label={showMnemonic ? '隐藏' : '显示'}
                  >
                    <Icon name={showMnemonic ? 'eye-off' : 'eye'} size={16} />
                  </button>
                  <button
                    onClick={copyMnemonic}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs text-ink-600 hover:bg-ink-50"
                  >
                    <Icon name="copy" size={14} />
                    <span className="hidden sm:inline">复制</span>
                  </button>
                </div>
                <p className="mt-2 flex items-center gap-1 text-xs text-amber-600">
                  <Icon name="sparkles" size={12} />
                  请把这 12 个词抄到离线位置。清浏览器数据后无法找回。
                </p>
              </div>
            ) : (
              <button
                onClick={handleRevealMnemonic}
                className="rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
              >
                显示我的恢复短语
              </button>
            )}

            <div className="mt-4 border-t border-ink-100 pt-4">
              <p className="mb-2 text-xs text-ink-500">换设备恢复</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputMnemonic}
                  onChange={(e) => setInputMnemonic(e.target.value)}
                  placeholder="粘贴 12 词恢复短语"
                  className="min-w-0 flex-1 rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
                />
                <button
                  onClick={handleRestoreFromMnemonic}
                  className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
                >
                  恢复
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 服务端访问令牌 */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium text-ink-900">服务端访问令牌</h2>
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <p className="mb-3 text-sm text-ink-600">
            所有云端能力（AI 对话、云端嵌入、同步）都需要访问令牌。部署时通过{' '}
            <code className="rounded bg-ink-100 px-1">wrangler secret put SYNC_TOKEN</code>{' '}
            设置，然后把同一令牌填在这里（仅存本设备，不参与笔记加密）。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={syncTokenInput}
              onChange={(e) => setSyncTokenInput(e.target.value)}
              placeholder={syncTokenSaved ? '已设置，输入新值覆盖' : '粘贴访问令牌'}
              className="min-w-0 flex-1 rounded-md border border-ink-200 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <button
              onClick={handleSaveSyncToken}
              disabled={!syncTokenInput.trim()}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              保存
            </button>
            {syncTokenSaved && (
              <button
                onClick={handleClearSyncToken}
                className="shrink-0 rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
              >
                清除
              </button>
            )}
          </div>
          <div className="mt-2">
            <span
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                syncTokenSaved ? 'bg-green-100 text-green-700' : 'bg-ink-100 text-ink-400'
              }`}
            >
              {syncTokenSaved ? '已配置' : '未配置'}
              <Icon name={syncTokenSaved ? 'check' : 'close'} size={12} />
            </span>
          </div>
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
            <button
              onClick={() => inboxInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/5 px-3 py-1.5 text-sm text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              <Icon name="upload" size={15} />
              飞书 inbox
              <input
                ref={inboxInputRef}
                type="file"
                accept=".md,.markdown"
                multiple
                onChange={handleImportInbox}
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
