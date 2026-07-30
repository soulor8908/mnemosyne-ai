import { describe, it, expect } from 'vitest';
import { extractArticle, formatSourcesForPrompt, GROUNDING_REFUSAL } from '@/lib/ai/grounding';
import type { SearchResult } from '@/lib/ai/search';
import type { Note } from '@/types';

function fakeResult(i: number, title: string, content: string): SearchResult {
  const note = { id: `n${i}`, title, content } as Note;
  return { note, score: 0.9 - i * 0.1, matchedBy: 'both' };
}

describe('extractArticle', () => {
  it('提取 <title> 并剥离 script/style 内容', () => {
    const html = `<!doctype html><html><head><title>  测试标题  </title>
      <style>.x{color:red}</style></head>
      <body><script>var secret=1;</script><p>正文第一段</p><p>正文第二段</p></body></html>`;
    const { title, text } = extractArticle(html);
    expect(title).toBe('测试标题');
    expect(text).toContain('正文第一段');
    expect(text).toContain('正文第二段');
    expect(text).not.toContain('var secret');
    expect(text).not.toContain('color:red');
  });

  it('优先采用 <article> 区域的正文', () => {
    const html = `<body><div>侧边栏噪音</div>
      <article><p>核心内容在这里</p></article>
      <footer>页脚噪音</footer></body>`;
    const { text } = extractArticle(html);
    expect(text).toContain('核心内容在这里');
    expect(text).not.toContain('侧边栏噪音');
    expect(text).not.toContain('页脚噪音');
  });

  it('解码常见 HTML 实体并折叠空白', () => {
    const html = `<body><p>Tom &amp; Jerry &lt;3 &quot;hi&quot;</p></body>`;
    const { text } = extractArticle(html);
    expect(text).toContain('Tom & Jerry <3 "hi"');
  });

  it('无标题时回退到默认名', () => {
    const { title } = extractArticle('<body><p>x</p></body>');
    expect(title).toBe('网页剪藏');
  });
});

describe('formatSourcesForPrompt', () => {
  it('按 [n] 编号并包含标题/来源ID', () => {
    const out = formatSourcesForPrompt([
      fakeResult(1, '笔记A', '内容A '.repeat(50)),
      fakeResult(2, '笔记B', '内容B'),
    ]);
    expect(out).toContain('[1] 笔记A');
    expect(out).toContain('[2] 笔记B');
    expect(out).toContain('(来源ID: n1)');
    expect(out).toContain('(来源ID: n2)');
  });

  it('单条内容被截断到 1000 字', () => {
    const long = 'x'.repeat(2000);
    const out = formatSourcesForPrompt([fakeResult(1, '长笔记', long)]);
    const section = out.split('---')[0];
    // 2000 字内容 + 标题与标记 ≈ 应被截断
    expect(section.length).toBeLessThan(1100 + 200);
  });
});

describe('GROUNDING_REFUSAL', () => {
  it('提供固定的拒答文案', () => {
    expect(GROUNDING_REFUSAL).toContain('无法回答');
  });
});
