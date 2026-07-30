// 溯源与剪藏的纯函数工具（无副作用，便于单测与复用）
import type { SearchResult } from './search';

// 基础 HTML 实体解码（覆盖常见实体，避免引入额外依赖）
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * 从 HTML 提取标题与正文文本（剪藏用）。
 * 策略：去掉 script/style/noscript/注释 → 优先 <article>/<main>，否则 <body> → 去标签 → 折叠空白。
 * 不依赖任何第三方库，可在 Cloudflare Workers 等无 DOM 环境运行。
 */
export function extractArticle(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeEntities(titleMatch ? titleMatch[1] : '').replace(/\s+/g, ' ').trim();

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const articleMatch =
    cleaned.match(/<article[\s\S]*?<\/article>/i) ?? cleaned.match(/<main[\s\S]*?<\/main>/i);
  const bodyHtml =
    articleMatch?.[0] ?? cleaned.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? cleaned;

  const text = decodeEntities(bodyHtml.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \u00a0]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();

  return { title: title || '网页剪藏', text: text.slice(0, 6000) };
}

/**
 * 将检索结果格式化为带编号的上下文，供 LLM 引用。
 * 编号 [1]..[n] 与 recall 页展示的来源顺序一致，模型据此用 [n] 标注出处。
 */
export function formatSourcesForPrompt(results: SearchResult[]): string {
  return results
    .map(
      (r, i) =>
        `## [${i + 1}] ${r.note.title}\n\n${r.note.content.slice(0, 1000)}\n\n(来源ID: ${r.note.id})`
    )
    .join('\n\n---\n\n');
}

// 拒答文案（诚实：无相关笔记时绝不编造）
export const GROUNDING_REFUSAL =
  '你的笔记中没有相关内容，我无法回答。';
