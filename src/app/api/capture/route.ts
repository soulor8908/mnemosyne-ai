// 网页剪藏 API：服务端抓取目标 URL 并提取正文（绕过浏览器 CORS）
// 笔记本体仍存于客户端 IndexedDB，此路由只负责「抓取 + 提取」，
// 返回结构化文本后由前端 createNote 落库（与同步模型一致）。
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/guard';
import { extractArticle } from '@/lib/ai/grounding';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_000_000; // 防止抓取超大页面撑爆 Worker 内存

export async function POST(req: NextRequest) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const { url } = (await req.json()) as { url?: unknown };
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      return NextResponse.json({ error: '请提供合法的 http(s) 链接' }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url.trim(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          // 部分站点对默认 UA 直接 403，带身份 UA 提高成功率
          'User-Agent':
            'Mnemosyne-Capture/1.0 (+https://github.com/soulor8908/mnemosyne-ai)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error).name === 'AbortError';
      return NextResponse.json(
        { error: aborted ? '抓取超时（12s）' : `抓取失败：${(e as Error).message}` },
        { status: 502 }
      );
    }
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ error: `目标返回 ${res.status}` }, { status: 502 });
    }

    // 体积护栏：只读取前 MAX_BYTES
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: '页面过大，已拒绝抓取' }, { status: 413 });
    }
    const html = new TextDecoder('utf-8').decode(buf);
    const { title, text } = extractArticle(html);

    if (!text.trim()) {
      return NextResponse.json({ error: '未能从页面提取到正文' }, { status: 422 });
    }

    return NextResponse.json({
      title,
      content: text,
      url: url.trim(),
      capturedAt: Date.now(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'capture failed' },
      { status: 500 }
    );
  }
}
