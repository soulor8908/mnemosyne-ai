// 浏览器内推理管理器：WebGPU 加速 + WASM 降级
//
// 在已有的 @xenova/transformers 本地嵌入（all-MiniLM-L6-v2，384 维）之上，
// 深化浏览器内推理能力：
//   - 检测并初始化 WebGPU，优先用 GPU 加速嵌入与补全
//   - 不可用或推理失败时透明降级到 WASM（@xenova/transformers 默认后端）
//   - 提供轻量本地补全（Xenova/distilgpt2），用于离线场景的基础补全
//   - 全程记录性能指标（device / latencyMs / model / task），供可观测性消费
//
// 注意：本模块只在浏览器端运行（与 src/lib/ai/embed.ts 的 embedLocal 一致），
// next.config.mjs 已将 @xenova/transformers 在服务端剔除。

// WebGPU 全局类型（@webgpu/types 不强制安装，统一用 any 兜底）
type GPUAdapter = any;
type GPUDevice = any;

// 推理设备类型
export type InferenceDevice = 'webgpu' | 'wasm';

// 嵌入结果
export interface EmbedResult {
  vector: number[]; // 归一化向量（384 维）
  device: InferenceDevice; // 实际使用的后端
  latencyMs: number; // 端到端延迟（毫秒）
  model: string; // 模型 ID
}

// 补全结果
export interface CompleteResult {
  text: string; // 生成的文本（已去掉前缀）
  device: InferenceDevice;
  latencyMs: number;
  model: string;
  generatedTokens: number; // 请求生成的 token 数
}

// 单条性能记录（供可观测性消费）
export interface InferenceMetric {
  device: InferenceDevice;
  latencyMs: number;
  model: string;
  task: 'embed' | 'complete';
  inputSize: number; // 输入规模（嵌入=文本长度，补全=前缀长度）
  outputSize: number; // 输出规模（嵌入=向量维度，补全=生成 token 数）
  timestamp: number;
}

// 当前能力快照
export interface Capabilities {
  webgpu: boolean; // WebGPU 是否已就绪（有可用 device）
  wasm: boolean; // WASM 后端是否可用（始终为 true）
  device: InferenceDevice; // 当前生效设备
}

// 嵌入模型 ID（all-MiniLM-L6-v2，384 维，与 embed.ts 保持一致）
const EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
// 补全模型 ID（GPT-2 蒸馏版，轻量，适合浏览器内补全）
const COMPLETE_MODEL_ID = 'Xenova/distilgpt2';

// 性能指标环形缓冲上限
const METRICS_LIMIT = 100;

// performance.now() 兜底（部分非浏览器环境可能缺失）
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * 浏览器内推理引擎：
 *   - 检测 WebGPU，优先用 GPU 加速嵌入与补全
 *   - 不可用或推理失败时透明降级到 WASM
 *   - 记录性能指标供上层可观测性消费
 *
 * 单例惰性初始化：第一次 embed()/complete() 会触发 init()。
 * 也支持直接 new 出独立实例（benchmark 场景用）。
 */
export class LocalInferenceEngine {
  private gpuDevice: GPUDevice | null = null;
  private embedPipeline: any = null;
  private completePipeline: any = null;
  private isInitialized = false;
  // 当前生效的推理设备
  private activeDevice: InferenceDevice = 'wasm';
  // 性能指标环形缓冲（最近 METRICS_LIMIT 条）
  private metrics: InferenceMetric[] = [];

  /**
   * 检测当前环境是否支持 WebGPU
   * 仅判断 navigator.gpu 是否存在，不发起任何请求
   */
  isWebGPUAvailable(): boolean {
    return typeof navigator !== 'undefined' && !!(navigator as any).gpu;
  }

  /**
   * 初始化 WebGPU 设备：请求 adapter + device
   * 失败返回 null（不抛错，由调用方决定是否降级）
   */
  async initWebGPU(): Promise<GPUDevice | null> {
    if (!this.isWebGPUAvailable()) return null;
    try {
      const gpu = (navigator as any).gpu;
      const adapter: GPUAdapter = await gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!adapter) return null;
      const device: GPUDevice = await adapter.requestDevice();
      this.gpuDevice = device;
      return device;
    } catch {
      // WebGPU 初始化失败（驱动/权限/上下文丢失等），静默降级
      this.gpuDevice = null;
      return null;
    }
  }

  /**
   * 初始化引擎：检测 WebGPU + 预加载嵌入模型
   * 多次调用幂等。
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;
    // 尝试初始化 WebGPU（失败不影响主流程，仅降级到 WASM）
    await this.initWebGPU();
    // 决定生效设备
    this.activeDevice = this.gpuDevice ? 'webgpu' : 'wasm';
    // 预加载嵌入 pipeline（补全 pipeline 惰性加载，避免不必要的下载）
    // 若 WebGPU pipeline 构建失败（如模型不支持 WebGPU 算子），降级到 WASM 重试
    try {
      await this.ensureEmbedPipeline();
    } catch (err) {
      if (this.activeDevice === 'webgpu') {
        this.activeDevice = 'wasm';
        this.embedPipeline = null;
        await this.ensureEmbedPipeline();
      } else {
        throw err;
      }
    }
    this.isInitialized = true;
  }

  /**
   * 获取/创建嵌入 pipeline
   * device 指定 ONNX runtime 后端：'webgpu' 或 'wasm'
   */
  private async ensureEmbedPipeline(): Promise<any> {
    if (this.embedPipeline) return this.embedPipeline;
    const mod = await import('@xenova/transformers');
    const device = this.activeDevice;
    this.embedPipeline = await mod.pipeline('feature-extraction', EMBED_MODEL_ID, {
      device,
    } as any);
    return this.embedPipeline;
  }

  /**
   * 获取/创建补全 pipeline（惰性加载，首次调用 complete() 时触发）
   */
  private async ensureCompletePipeline(): Promise<any> {
    if (this.completePipeline) return this.completePipeline;
    const mod = await import('@xenova/transformers');
    const device = this.activeDevice;
    this.completePipeline = await mod.pipeline('text-generation', COMPLETE_MODEL_ID, {
      device,
    } as any);
    return this.completePipeline;
  }

  /**
   * 嵌入单条文本：WebGPU 优先，失败降级 WASM
   * 返回 384 维归一化向量 + 设备 + 延迟
   */
  async embed(text: string): Promise<EmbedResult> {
    await this.init();
    const start = nowMs();
    try {
      const pipeline = await this.ensureEmbedPipeline();
      const output = await pipeline(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data as Float32Array);
      const latencyMs = nowMs() - start;
      this.recordMetric({
        device: this.activeDevice,
        latencyMs,
        model: EMBED_MODEL_ID,
        task: 'embed',
        inputSize: text.length,
        outputSize: vector.length,
      });
      return { vector, device: this.activeDevice, latencyMs, model: EMBED_MODEL_ID };
    } catch (err) {
      // WebGPU 推理失败 → 降级 WASM 重试一次
      if (this.activeDevice === 'webgpu') {
        return this.embedFallbackWasm(text, start, err);
      }
      throw err;
    }
  }

  /**
   * WebGPU 失败时的 WASM 降级路径
   * 重新构建 pipeline（device='wasm'）并重跑嵌入
   */
  private async embedFallbackWasm(
    text: string,
    startTimestamp: number,
    originalError: unknown
  ): Promise<EmbedResult> {
    try {
      this.activeDevice = 'wasm';
      this.embedPipeline = null; // 清理可能损坏的 webgpu pipeline
      const pipeline = await this.ensureEmbedPipeline();
      const output = await pipeline(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data as Float32Array);
      const latencyMs = nowMs() - startTimestamp;
      this.recordMetric({
        device: 'wasm',
        latencyMs,
        model: EMBED_MODEL_ID,
        task: 'embed',
        inputSize: text.length,
        outputSize: vector.length,
      });
      return { vector, device: 'wasm', latencyMs, model: EMBED_MODEL_ID };
    } catch {
      throw originalError;
    }
  }

  /**
   * 本地补全（distilgpt2）：离线场景的轻量补全
   * @param prefix 前缀文本
   * @param maxNewTokens 最大生成 token 数（默认 16）
   */
  async complete(prefix: string, maxNewTokens = 16): Promise<CompleteResult> {
    await this.init();
    const start = nowMs();
    try {
      const pipeline = await this.ensureCompletePipeline();
      const output = await pipeline(prefix, { max_new_tokens: maxNewTokens });
      const generated = extractGeneratedText(output, prefix);
      const latencyMs = nowMs() - start;
      this.recordMetric({
        device: this.activeDevice,
        latencyMs,
        model: COMPLETE_MODEL_ID,
        task: 'complete',
        inputSize: prefix.length,
        outputSize: maxNewTokens,
      });
      return {
        text: generated,
        device: this.activeDevice,
        latencyMs,
        model: COMPLETE_MODEL_ID,
        generatedTokens: maxNewTokens,
      };
    } catch (err) {
      if (this.activeDevice === 'webgpu') {
        return this.completeFallbackWasm(prefix, maxNewTokens, start, err);
      }
      throw err;
    }
  }

  /**
   * 补全的 WASM 降级路径
   */
  private async completeFallbackWasm(
    prefix: string,
    maxNewTokens: number,
    startTimestamp: number,
    originalError: unknown
  ): Promise<CompleteResult> {
    try {
      this.activeDevice = 'wasm';
      this.completePipeline = null;
      const pipeline = await this.ensureCompletePipeline();
      const output = await pipeline(prefix, { max_new_tokens: maxNewTokens });
      const generated = extractGeneratedText(output, prefix);
      const latencyMs = nowMs() - startTimestamp;
      this.recordMetric({
        device: 'wasm',
        latencyMs,
        model: COMPLETE_MODEL_ID,
        task: 'complete',
        inputSize: prefix.length,
        outputSize: maxNewTokens,
      });
      return {
        text: generated,
        device: 'wasm',
        latencyMs,
        model: COMPLETE_MODEL_ID,
        generatedTokens: maxNewTokens,
      };
    } catch {
      throw originalError;
    }
  }

  /**
   * 当前能力快照
   */
  getCapabilities(): Capabilities {
    return {
      webgpu: !!this.gpuDevice,
      wasm: true, // WASM 后端始终可用（@xenova/transformers 默认）
      device: this.activeDevice,
    };
  }

  /**
   * 写入性能指标（环形缓冲，超出限制丢弃最旧）
   * timestamp 由内部自动填充
   */
  private recordMetric(m: Omit<InferenceMetric, 'timestamp'>): void {
    this.metrics.push({ ...m, timestamp: Date.now() });
    if (this.metrics.length > METRICS_LIMIT) {
      this.metrics.shift();
    }
  }

  /**
   * 读取性能指标快照
   * @param limit 仅返回最近 N 条（不传则全部）
   */
  getMetrics(limit?: number): InferenceMetric[] {
    return limit ? this.metrics.slice(-limit) : [...this.metrics];
  }

  /**
   * 重置引擎状态（仅测试用，命名加下划线前缀以表明用途）
   */
  _resetForTests(): void {
    this.gpuDevice = null;
    this.embedPipeline = null;
    this.completePipeline = null;
    this.isInitialized = false;
    this.activeDevice = 'wasm';
    this.metrics = [];
  }
}

/**
 * 从 transformers.js text-generation 的输出中提取"生成部分"文本
 * transformers.js 不同版本返回结构略有差异：
 *   - 多数情况：[{ generated_text: "前缀+生成" }]
 *   - 部分版本：{ generated_text: ["前缀", "生成"] }
 * 统一提取出"生成部分"，并兼容前缀未重复的情况
 */
function extractGeneratedText(output: any, prefix: string): string {
  const raw = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
  let fullText: string;
  if (typeof raw === 'string') {
    fullText = raw;
  } else if (Array.isArray(raw)) {
    // 数组形式：最后一个元素是生成部分
    fullText = typeof raw[raw.length - 1] === 'string' ? raw[raw.length - 1] : String(raw ?? '');
  } else {
    fullText = String(raw ?? '');
  }
  // 去掉前缀，只保留生成部分
  return fullText.startsWith(prefix) ? fullText.slice(prefix.length) : fullText;
}

// —— 进程级单例 + 顶层函数封装（任务要求的 API 形态） ——

let _engineSingleton: LocalInferenceEngine | null = null;

export function getLocalInferenceEngine(): LocalInferenceEngine {
  if (!_engineSingleton) {
    _engineSingleton = new LocalInferenceEngine();
  }
  return _engineSingleton;
}

/**
 * 顶层 API：WebGPU 检测（不依赖实例）
 */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).gpu;
}

/**
 * 顶层 API：初始化 WebGPU 设备（基于单例引擎）
 */
export async function initWebGPU(): Promise<GPUDevice | null> {
  return getLocalInferenceEngine().initWebGPU();
}

/**
 * 顶层 API：用 WebGPU 优先做嵌入（降级 WASM）
 * 返回向量 + 实际使用的设备 + 延迟
 */
export async function embedWithWebGPU(
  text: string
): Promise<{ vector: number[]; device: string; latencyMs: number }> {
  const result = await getLocalInferenceEngine().embed(text);
  return { vector: result.vector, device: result.device, latencyMs: result.latencyMs };
}

/**
 * 顶层 API：本地补全（distilgpt2）
 */
export async function completeLocal(prefix: string): Promise<string> {
  const result = await getLocalInferenceEngine().complete(prefix);
  return result.text;
}
