'use client';

// 登录页：零信任登录的唯一入口。
// 零信任机制（BIP39 + SCRAM-lite 挑战应答）在后台自动执行，
// 用户侧只看到：创建钥匙 → 抄写12词 → 登录完成。
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { getSyncToken } from '@/lib/api/client';
import {
  ensureMasterKey,
  getCachedMnemonic,
  restoreFromMnemonic,
  getOrCreateUserPrefs,
} from '@/lib/auth/user-prefs';
import { loginWithMnemonic } from '@/lib/auth/client-auth';

type Step = 'loading' | 'intro' | 'show-words' | 'restore' | 'logging-in' | 'done';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('loading');
  const [mnemonic, setMnemonic] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [restoreInput, setRestoreInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    async function init() {
      const from = searchParams.get('from') || '/';

      // 已登录 → 跳回来源页
      if (getSyncToken()) {
        router.replace(from);
        return;
      }

      // 内存中有钥匙（同一会话内 session 过期）→ 直接登录
      if (getCachedMnemonic()) {
        setStep('logging-in');
        try {
          await loginWithMnemonic();
          setStep('done');
          setTimeout(() => router.replace(from), 800);
        } catch {
          setStep('intro');
        }
        return;
      }

      // 检查是否已有 masterKeyHash（换设备场景）
      const prefs = await getOrCreateUserPrefs();
      if (prefs.masterKeyHash) {
        setStep('restore');
      } else {
        setStep('intro');
      }
    }
    init();
  }, [router, searchParams]);

  // 首次创建钥匙
  async function handleCreate() {
    setError('');
    setStep('logging-in');
    try {
      const { mnemonic: m } = await ensureMasterKey();
      setMnemonic(m);
      setStep('show-words');
    } catch {
      setError('创建钥匙失败，请重试');
      setStep('intro');
    }
  }

  // 确认已抄写 → 自动登录
  async function handleConfirmAndLogin() {
    setError('');
    setStep('logging-in');
    try {
      await loginWithMnemonic();
      setStep('done');
      const from = searchParams.get('from') || '/';
      setTimeout(() => router.replace(from), 800);
    } catch {
      setError('登录失败，请检查网络后重试');
      setStep('show-words');
    }
  }

  // 换设备：输入12词恢复并登录
  async function handleRestore() {
    setError('');
    if (!restoreInput.trim()) {
      setError('请输入你的 12 个词');
      return;
    }
    setStep('logging-in');
    try {
      await restoreFromMnemonic(restoreInput.trim());
      await loginWithMnemonic();
      setStep('done');
      const from = searchParams.get('from') || '/';
      setTimeout(() => router.replace(from), 800);
    } catch (e) {
      setError((e as Error).message || '恢复失败，请检查你的 12 个词');
      setStep('restore');
    }
  }

  const from = searchParams.get('from') || '/';

  // ---------- 渲染 ----------

  if (step === 'loading' || step === 'logging-in') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-ink-300 border-t-accent" />
          <p className="text-sm text-ink-500">
            {step === 'loading' ? '正在准备…' : '登录中…'}
          </p>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <Icon name="check" size={24} className="text-green-600" />
          </div>
          <p className="text-lg font-medium text-ink-900">登录成功</p>
          <p className="text-sm text-ink-500">正在跳转…</p>
        </div>
      </div>
    );
  }

  if (step === 'restore') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-8 shadow-sm">
          <Link
            href={from}
            className="mb-4 inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-600"
          >
            <Icon name="chevron-right" size={14} className="rotate-180" />
            返回
          </Link>

          <h1 className="mb-2 text-2xl font-semibold text-ink-900">输入你的钥匙</h1>
          <p className="mb-6 text-sm text-ink-500">
            在新设备上输入你安全保存的 12 个词，即可恢复笔记访问。
          </p>

          <textarea
            value={restoreInput}
            onChange={(e) => setRestoreInput(e.target.value)}
            placeholder="apple banana cherry …"
            rows={3}
            className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
            autoFocus
          />

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            onClick={handleRestore}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            恢复并登录
          </button>

          <p className="mt-4 text-center text-xs text-ink-400">
            首次使用本设备？
            <button
              onClick={() => setStep('intro')}
              className="ml-1 text-accent hover:underline"
            >
              创建新钥匙
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (step === 'show-words') {
    const words = mnemonic.split(' ');
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-8 shadow-sm">
          <h1 className="mb-2 text-2xl font-semibold text-ink-900">你的钥匙</h1>
          <p className="mb-4 text-sm text-ink-500">
            请把这 12 个词抄到安全的地方（如纸质笔记本）。
          </p>

          {/* 警告 */}
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs text-amber-800">
              丢了这 12 个词，谁都救不回你的笔记。也不会有"找回密码"。
            </p>
          </div>

          {/* 12 词网格 */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            {words.map((word, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2"
              >
                <span className="text-xs text-ink-400">{i + 1}</span>
                <span className="text-sm font-medium text-ink-900">
                  {revealed ? word : '••••'}
                </span>
              </div>
            ))}
          </div>

          {/* 显示/隐藏切换 */}
          <button
            onClick={() => setRevealed((v) => !v)}
            className="mb-4 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-700"
          >
            <Icon name={revealed ? 'eye-off' : 'eye'} size={14} />
            {revealed ? '隐藏' : '显示'}
          </button>

          {/* 确认复选框 */}
          <label className="mb-4 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent focus:ring-accent"
            />
            <span className="text-sm text-ink-600">
              我已把这 12 个词抄到安全的地方
            </span>
          </label>

          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

          <button
            onClick={handleConfirmAndLogin}
            disabled={!confirmChecked}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            完成并登录
          </button>
        </div>
      </div>
    );
  }

  // step === 'intro'
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-8 shadow-sm">
        <Link
          href={from}
          className="mb-4 inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-600"
        >
          <Icon name="chevron-right" size={14} className="rotate-180" />
          返回
        </Link>

        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
          <Icon name="logo" size={28} className="text-accent" />
        </div>

        <h1 className="mb-3 text-2xl font-semibold text-ink-900">
          你的笔记只属于你
        </h1>
        <p className="mb-6 text-sm leading-relaxed text-ink-500">
          我们会用 12 个词生成一把钥匙，加密你的笔记和 AI 配置。
          <br />
          钥匙只存在你的浏览器里，服务器永远拿不到。
        </p>

        <button
          onClick={handleCreate}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          创建我的钥匙
        </button>

        <p className="mt-6 text-center text-xs text-ink-400">
          已有钥匙？
          <button
            onClick={() => setStep('restore')}
            className="ml-1 text-accent hover:underline"
          >
            输入 12 个词恢复
          </button>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-ink-50">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-ink-300 border-t-accent" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
