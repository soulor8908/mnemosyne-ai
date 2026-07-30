import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest 以项目根目录为 cwd；openapi.yaml 置于仓库根
const specPath = resolve(process.cwd(), 'openapi.yaml');
const spec = parse(readFileSync(specPath, 'utf-8')) as any;

describe('openapi.yaml 规范校验', () => {
  it('是 OpenAPI 3.1 文档', () => {
    expect(spec.openapi).toBe('3.1.0');
  });

  it('声明 bearerAuth 安全方案', () => {
    expect(spec.components.securitySchemes.bearerAuth.type).toBe('http');
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('文档化全部公开路径', () => {
    const expected = [
      '/api/embed',
      '/api/search',
      '/api/chat',
      '/api/capture',
      '/api/sync',
      '/api/auth/start',
      '/api/auth/verify',
      '/api/agent',
    ];
    for (const p of expected) {
      expect(spec.paths[p], `缺少路径 ${p}`).toBeTruthy();
    }
  });

  it('/api/sync 支持 GET/POST/PUT 且均定义 200', () => {
    const sync = spec.paths['/api/sync'];
    for (const m of ['get', 'post', 'put']) {
      expect(sync[m], `sync 缺少 ${m}`).toBeTruthy();
      expect(sync[m].responses['200'], `sync ${m} 缺少 200`).toBeTruthy();
    }
  });

  it('写入类端点声明 401 未认证响应', () => {
    for (const p of ['/api/embed', '/api/search', '/api/capture']) {
      expect(spec.paths[p].post.responses['401'], `${p} 缺少 401`).toBeTruthy();
    }
  });

  it('关键 schema 存在且含必需字段', () => {
    expect(spec.components.schemas.Note.required).toContain('id');
    expect(spec.components.schemas.EmbedResponse.required).toEqual(
      expect.arrayContaining(['vector', 'model', 'dim'])
    );
    expect(spec.components.schemas.SyncPutBody.properties.key.pattern).toContain('delta');
  });

  it('描述了 E2E 加密边界', () => {
    expect(JSON.stringify(spec.info.description)).toContain('端到端加密');
  });
});
