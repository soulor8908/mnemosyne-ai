// 单元测试：浏览器内推理引擎（LocalInferenceEngine）
//
// 覆盖：
//   1. WebGPU 检测（mock navigator.gpu）
//   2. 降级逻辑（WebGPU 不可用 / 初始化失败 / 推理失败时降级 WASM）
//   3. getCapabilities 返回结构
//   4. embed 返回结构（mock pipeline，不真正加载大模型）
//   5. complete 返回结构
//   6. 性能指标记录（getMetrics）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 用 vi.hoisted 定义 mock 函数，使其在 vi.mock 工厂（hoisted）中可引用
const mocks = vi.hoisted(() => ({
  pipeline: vi.fn(),
}));

// mock @xenova/transformers，避免测试时真实下载/加载大模型
vi.mock('@xenova/transformers', () => ({
  pipeline: mocks.pipeline,
  env: { allowLocalModels: false },
}));

import {
  LocalInferenceEngine,
  isWebGPUAvailable,
  embedWithWebGPU,
  completeLocal,
} from '@/lib/ai/local-inference';

// —— fake pipeline 构造器 ——

// 默认的嵌入 pipeline：返回 384 维向量
function fakeEmbedPipeline() {
  return vi.fn(async (_text: string) => ({
    data: new Float32Array(384).fill(0.5),
    tolist: () => [Array.from(new Float32Array(384).fill(0.5))],
  }));
}

// 默认的补全 pipeline：返回前缀 + 生成文本
function fakeCompletePipeline() {
  return vi.fn(async (prefix: string) => [
    { generated_text: prefix + ' 模拟补全文本' },
  ]);
}

// —— navigator.gpu 控制 ——

// 设置 navigator.gpu（模拟 WebGPU 可用）
function setNavigatorGPU(value: unknown) {
  Object.defineProperty(navigator, 'gpu', {
    value,
    configurable: true,
    writable: true,
  });
}

// 清除 navigator.gpu（模拟 WebGPU 不可用）
function clearNavigatorGPU() {
  try {
    delete (navigator as any).gpu;
  } catch {
    (navigator as any).gpu = undefined;
  }
}

// 模拟一个能成功返回 device 的 navigator.gpu
function setNavigatorGPUWorking() {
  setNavigatorGPU({
    requestAdapter: vi.fn().mockResolvedValue({
      requestDevice: vi.fn().mockResolvedValue({ label: 'mock-gpu-device' }),
    }),
  });
}

// 模拟 requestAdapter 返回 null（无可用 GPU adapter）
function setNavigatorGPUNoAdapter() {
  setNavigatorGPU({
    requestAdapter: vi.fn().mockResolvedValue(null),
  });
}

beforeEach(() => {
  // 重置 pipeline mock 为默认成功行为
  mocks.pipeline.mockReset();
  mocks.pipeline.mockImplementation(async (task: string) => {
    if (task === 'feature-extraction') return fakeEmbedPipeline();
    if (task === 'text-generation') return fakeCompletePipeline();
    return vi.fn();
  });
  // 默认无 WebGPU
  clearNavigatorGPU();
});

afterEach(() => {
  clearNavigatorGPU();
});

describe('WebGPU 检测', () => {
  it('navigator.gpu 不存在时 isWebGPUAvailable 返回 false', () => {
    clearNavigatorGPU();
    expect(isWebGPUAvailable()).toBe(false);
  });

  it('navigator.gpu 存在时 isWebGPUAvailable 返回 true', () => {
    setNavigatorGPU({});
    expect(isWebGPUAvailable()).toBe(true);
  });

  it('引擎实例的 isWebGPUAvailable 与顶层函数行为一致', () => {
    const engine = new LocalInferenceEngine();
    clearNavigatorGPU();
    expect(engine.isWebGPUAvailable()).toBe(false);
    setNavigatorGPU({});
    expect(engine.isWebGPUAvailable()).toBe(true);
  });
});

describe('降级逻辑', () => {
  it('WebGPU 不可用时 embed 降级到 WASM', async () => {
    clearNavigatorGPU();
    const engine = new LocalInferenceEngine();
    const result = await engine.embed('测试文本');
    expect(result.device).toBe('wasm');
    expect(result.vector).toHaveLength(384);
  });

  it('WebGPU 初始化失败（requestAdapter 返回 null）时降级 WASM', async () => {
    setNavigatorGPUNoAdapter();
    const engine = new LocalInferenceEngine();
    await engine.init();
    const caps = engine.getCapabilities();
    expect(caps.webgpu).toBe(false);
    expect(caps.device).toBe('wasm');
    const result = await engine.embed('测试');
    expect(result.device).toBe('wasm');
  });

  it('WebGPU 嵌入推理失败时降级 WASM 重试', async () => {
    // WebGPU 设备初始化成功，嵌入 pipeline 构建成功，但推理时抛错
    setNavigatorGPUWorking();
    // pipeline 在 device='webgpu' 时构建成功但调用抛错；device='wasm' 时正常
    mocks.pipeline.mockImplementation(async (task: string, _model: string, opts?: any) => {
      if (task === 'feature-extraction') {
        if (opts?.device === 'webgpu') {
          // 构建成功，但推理时抛错（触发 embed 方法的降级路径）
          return vi.fn(async () => {
            throw new Error('WebGPU 推理失败');
          });
        }
        return fakeEmbedPipeline();
      }
      if (task === 'text-generation') return fakeCompletePipeline();
      return vi.fn();
    });

    const engine = new LocalInferenceEngine();
    const result = await engine.embed('降级测试');
    // init 用 WebGPU 构建成功，embed 推理抛错 → 降级 WASM 重试
    expect(result.device).toBe('wasm');
    expect(result.vector).toHaveLength(384);
    expect(result.model).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('WebGPU 嵌入 pipeline 构建失败时 init 降级 WASM', async () => {
    // WebGPU 设备初始化成功，但 pipeline 构建直接抛错（模型不支持 WebGPU 算子）
    setNavigatorGPUWorking();
    mocks.pipeline.mockImplementation(async (_task: string, _model: string, opts?: any) => {
      if (opts?.device === 'webgpu') {
        throw new Error('WebGPU 不支持此模型算子');
      }
      return fakeEmbedPipeline();
    });

    const engine = new LocalInferenceEngine();
    await engine.init();
    // init 阶段降级到 WASM（设备本身可用，但 pipeline 不支持 WebGPU，故 device=wasm）
    const caps = engine.getCapabilities();
    expect(caps.device).toBe('wasm');
    const result = await engine.embed('init 降级测试');
    expect(result.device).toBe('wasm');
    expect(result.vector).toHaveLength(384);
  });

  it('WebGPU 可用但补全 pipeline 抛错时降级 WASM 重试', async () => {
    setNavigatorGPUWorking();
    // 嵌入 pipeline 在 WebGPU 下正常（init 不降级），补全 pipeline 在 WebGPU 下抛错
    mocks.pipeline.mockImplementation(async (task: string, _model: string, opts?: any) => {
      if (task === 'feature-extraction') return fakeEmbedPipeline();
      if (task === 'text-generation') {
        if (opts?.device === 'webgpu') {
          throw new Error('WebGPU 补全失败');
        }
        return fakeCompletePipeline();
      }
      return vi.fn();
    });

    const engine = new LocalInferenceEngine();
    const result = await engine.complete('前缀');
    // init 用 WebGPU 成功（嵌入正常），补全 pipeline 构建失败 → 降级 WASM
    expect(result.device).toBe('wasm');
    expect(result.text).toContain('模拟补全文本');
  });

  it('WASM 模式下推理失败时直接抛错（不再降级）', async () => {
    clearNavigatorGPU();
    mocks.pipeline.mockImplementation(async () => {
      throw new Error('WASM 也失败了');
    });
    const engine = new LocalInferenceEngine();
    await expect(engine.embed('失败测试')).rejects.toThrow('WASM 也失败了');
  });
});

describe('getCapabilities', () => {
  it('未初始化时返回 wasm 兜底', () => {
    const engine = new LocalInferenceEngine();
    const caps = engine.getCapabilities();
    expect(caps).toHaveProperty('webgpu');
    expect(caps).toHaveProperty('wasm');
    expect(caps).toHaveProperty('device');
    expect(caps.wasm).toBe(true);
    expect(caps.webgpu).toBe(false);
    expect(caps.device).toBe('wasm');
  });

  it('WebGPU 可用并初始化成功后返回 webgpu 能力', async () => {
    setNavigatorGPUWorking();
    const engine = new LocalInferenceEngine();
    await engine.init();
    const caps = engine.getCapabilities();
    expect(caps.webgpu).toBe(true);
    expect(caps.device).toBe('webgpu');
  });

  it('WebGPU 不可用时初始化后仍为 wasm', async () => {
    clearNavigatorGPU();
    const engine = new LocalInferenceEngine();
    await engine.init();
    const caps = engine.getCapabilities();
    expect(caps.webgpu).toBe(false);
    expect(caps.device).toBe('wasm');
  });
});

describe('embed 返回结构', () => {
  it('返回 384 维向量 + device + latencyMs + model', async () => {
    clearNavigatorGPU();
    const engine = new LocalInferenceEngine();
    const result = await engine.embed('hello world');
    expect(Array.isArray(result.vector)).toBe(true);
    expect(result.vector).toHaveLength(384);
    expect(result.device).toBe('wasm');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.model).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('顶层 embedWithWebGPU 函数返回简化结构', async () => {
    clearNavigatorGPU();
    const result = await embedWithWebGPU('顶层调用');
    expect(result.vector).toHaveLength(384);
    expect(result.device).toBe('wasm');
    expect(typeof result.latencyMs).toBe('number');
  });
});

describe('complete 返回结构', () => {
  it('返回生成文本（去掉前缀）+ device + model', async () => {
    clearNavigatorGPU();
    const engine = new LocalInferenceEngine();
    const result = await engine.complete('前缀');
    expect(typeof result.text).toBe('string');
    expect(result.text).not.toContain('前缀');
    expect(result.text).toContain('模拟补全文本');
    expect(result.device).toBe('wasm');
    expect(result.model).toBe('Xenova/distilgpt2');
    expect(result.generatedTokens).toBe(16); // 默认值
  });

  it('支持自定义 maxNewTokens', async () => {
    clearNavigatorGPU();
    const engine = new LocalInferenceEngine();
    const result = await engine.complete('前缀', 32);
    expect(result.generatedTokens).toBe(32);
  });

  it('顶层 completeLocal 函数返回生成的字符串', async () => {
    clearNavigatorGPU();
    const text = await completeLocal('顶层前缀');
    expect(typeof text).toBe('string');
    expect(text).toContain('模拟补全文本');
  });
});

describe('性能监控', () => {
  it('embed 后记录性能指标', async () => {
    clearNavigatorGPU();
    const engine = new LocalInferenceEngine();
    await engine.embed('性能测试');
    const metrics = engine.getMetrics();
    expect(metrics.length).toBe(1);
    expect(metrics[0].task).toBe('embed');
    expect(metrics[0].device).toBe('wasm');
    expect(metrics[0].model).toBe('Xenova/all-MiniLM-L6-v2');
    expect(metrics[0].outputSize).toBe(384);
  });

  it('complete 后记录性能指标', async () => {
    clearNavigatorGPU();
    const engine = new LocalInferenceEngine();
    await engine.complete('补全性能', 20);
    const metrics = engine.getMetrics();
    expect(metrics.length).toBe(1);
    expect(metrics[0].task).toBe('complete');
    expect(metrics[0].outputSize).toBe(20);
  });

  it('getMetrics(limit) 只返回最近 N 条', async () => {
    clearNavigatorGPU();
    const engine = new LocalInferenceEngine();
    await engine.embed('a');
    await engine.embed('b');
    const limited = engine.getMetrics(1);
    expect(limited.length).toBe(1);
    // 最近的应是 'b'（inputSize=1）
    expect(limited[0].inputSize).toBe(1);
  });
});

describe('init 幂等性', () => {
  it('多次调用 init 不会重复加载 pipeline', async () => {
    clearNavigatorGPU();
    const engine = new LocalInferenceEngine();
    await engine.init();
    await engine.init();
    await engine.init();
    // pipeline 只应被调用一次（嵌入模型预加载）
    expect(mocks.pipeline).toHaveBeenCalledTimes(1);
  });
});
