import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MnemosyneClient,
  searchExport,
  extractTerms,
  parseChatDataStream,
  type ExportNote,
} from '@/mcp/client';

// 最小化的 fetch 桩：只实现客户端用到的成员
function jsonResponse(body: unknown, ok = true, status = 200): any {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
function textResponse(text: string, ok = true, status = 200): any {
  return {
    ok,
    status,
    json: async () => {
      throw new Error('not json');
    },
    text: async () => text,
  };
}

describe('MnemosyneClient（服务端可达端点）', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captureWebpage：POST /api/capture 且带 Bearer 令牌，返回正文', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ title: '示例', content: '正文内容', url: 'https://x.com', capturedAt: 123 })
    );
    const client = new MnemosyneClient({
      baseUrl: 'https://app.example.com/',
      token: 'secret',
      fetchImpl: fetchMock as any,
    });
    const r = await client.captureWebpage('https://x.com');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.example.com/api/capture');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).url).toBe('https://x.com');
    expect(r.title).toBe('示例');
    expect(r.content).toBe('正文内容');
  });

  it('captureWebpage：非法 URL 直接抛错，不发请求', async () => {
    const client = new MnemosyneClient({
      baseUrl: 'https://app.example.com',
      token: 't',
      fetchImpl: fetchMock as any,
    });
    await expect(client.captureWebpage('not-a-url')).rejects.toThrow('合法的 http');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('embedText：POST /api/embed 返回向量', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ vector: [0.1, 0.2], model: 'bge-base-en-v1.5', dim: 768 }));
    const client = new MnemosyneClient({ baseUrl: 'http://localhost:3000', token: 't', fetchImpl: fetchMock as any });
    const r = await client.embedText('hello world');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/embed');
    expect(r.vector).toEqual([0.1, 0.2]);
    expect(r.dim).toBe(768);
  });

  it('ask：解析 Vercel AI data stream 的 0:"..." 文本增量', async () => {
    // 模拟分多条 0: 增量，末尾带 8: 结束标记
    const stream =
      '0:"你的笔记中"\n' +
      '0:"提到了 [1] 项目启动会。"\n' +
      '8:{"finishReason":"stop"}\n';
    fetchMock.mockResolvedValue(textResponse(stream));
    const client = new MnemosyneClient({ baseUrl: 'http://localhost:3000', token: 't', fetchImpl: fetchMock as any });
    const r = await client.ask('项目何时启动？', '笔记上下文...');
    expect(r.answer).toBe('你的笔记中提到了 [1] 项目启动会。');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/chat');
    expect(JSON.parse(init.body).messages[0]).toEqual({ role: 'user', content: '项目何时启动？' });
  });

  it('ask：服务端 503（未配置 provider）时抛出错误', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: '未配置 AI provider' }, false, 503));
    const client = new MnemosyneClient({ baseUrl: 'http://localhost:3000', token: 't', fetchImpl: fetchMock as any });
    await expect(client.ask('hi')).rejects.toThrow('未配置 AI provider');
  });

  it('search：POST /api/search 返回 queryVector', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ queryVector: [1, 2, 3], model: 'bge-base-en-v1.5' }));
    const client = new MnemosyneClient({ baseUrl: 'http://localhost:3000', token: 't', fetchImpl: fetchMock as any });
    const r = await client.search('测试');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/search');
    expect(r.queryVector).toEqual([1, 2, 3]);
  });

  it('searchNotes：未配置导出文件时只返回 queryVector', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ queryVector: [9], model: 'bge-base-en-v1.5' }));
    const client = new MnemosyneClient({ baseUrl: 'http://localhost:3000', token: 't', fetchImpl: fetchMock as any });
    const r = await client.searchNotes('hello');
    expect(r.queryVector).toEqual([9]);
    expect(r.localMatches).toBeUndefined();
  });

  it('searchNotes：配置导出文件后做本机关键词检索', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ queryVector: [9], model: 'bge-base-en-v1.5' }));
    const fakeNotes: ExportNote[] = [
      { id: 'a', title: 'Rust 入门', content: 'Rust 的所有权与生命周期是核心概念。' },
      { id: 'b', title: '每日复盘', content: '今天学习了 Rust 的 borrow checker。' },
      { id: 'c', title: '菜谱', content: '番茄炒蛋的做法。' },
    ];
    const client = new MnemosyneClient({
      baseUrl: 'http://localhost:3000',
      token: 't',
      fetchImpl: fetchMock as any,
      notesExportPath: '/tmp/fake-export.json',
      readExport: async () => fakeNotes,
    });
    const r = await client.searchNotes('Rust', 2);
    expect(r.localMatches).toBeDefined();
    expect(r.localMatches!.length).toBe(2);
    // 标题命中的 a 应排在内容命中的 b 之前（标题权重更高）
    expect(r.localMatches![0].id).toBe('a');
    expect(r.localMatches![0].snippet).toContain('Rust');
  });
});

describe('本地导出检索（纯函数）', () => {
  const notes: ExportNote[] = [
    { id: '1', title: 'Kubernetes 调度', content: 'Kubernetes 的调度器负责把 Pod 分配到节点。' },
    { id: '2', title: '读书笔记', content: '本周读了《人月神话》，关于布鲁克斯定律。' },
    { id: '3', title: 'K8s 运维', content: 'kubernetes 集群升级要注意 API 废弃。' },
  ];

  it('extractTerms：英文词 + 连续中文分别成词', () => {
    expect(extractTerms('Kubernetes 调度 核心')).toEqual(['kubernetes', '调度', '核心']);
  });

  it('searchExport：标题命中权重高于内容，且大小写不敏感', () => {
    const r = searchExport(notes, 'kubernetes', 5);
    expect(r.length).toBe(2);
    expect(r[0].id).toBe('1'); // 标题命中
    expect(r[1].id).toBe('3'); // 内容命中（小写 k8s 不匹配，但 kubernetes 在内容）
  });

  it('searchExport：中文检索可用', () => {
    const r = searchExport(notes, '读书', 5);
    expect(r.length).toBe(1);
    expect(r[0].id).toBe('2');
  });

  it('searchExport：空查询返回空', () => {
    expect(searchExport(notes, '   ', 5)).toEqual([]);
  });

  it('searchExport：topK 截断', () => {
    const r = searchExport(notes, 'kubernetes', 1);
    expect(r.length).toBe(1);
  });
});

describe('parseChatDataStream', () => {
  it('累加多条 0: 增量并忽略非文本行', () => {
    const s = 'retry:1000\n0:"你好"\n0:"世界"\n8:{"finishReason":"stop"}\n';
    expect(parseChatDataStream(s)).toBe('你好世界');
  });
  it('还原转义（含换行）', () => {
    const s = '0:"第一行\\n第二行"';
    expect(parseChatDataStream(s)).toBe('第一行\n第二行');
  });
});
