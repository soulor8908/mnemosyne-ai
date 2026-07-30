// 核心类型定义（对齐技术设计文档第 3 节）

export type NoteStatus = 'draft' | 'settled' | 'archived';
export type NoteSource = 'manual' | 'clip' | 'voice' | 'bot' | 'email' | 'import' | 'feishu' | 'web';
export type NoteType = 'note' | 'clip' | 'meeting' | 'idea' | 'reading';
export type SyncStatus = 'local' | 'synced' | 'pending' | 'conflict';
export type EncryptionMode = 'plain' | 'e2e';

export interface NoteFrontmatter {
  type?: NoteType;
  sourceUrl?: string;
  author?: string;
  publishedAt?: number;
  [k: string]: unknown;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  frontmatter: NoteFrontmatter;
  folderId: string | null;
  tags: string[];
  status: NoteStatus;
  source: NoteSource;
  sourceMeta?: {
    url?: string;
    capturedAt?: number;
    feishuChatId?: string;
    feishuMessageId?: string;
  };
  createdAt: number;
  updatedAt: number;
  accessedAt: number;
  rev: number;
  syncStatus: SyncStatus;
  encryption: EncryptionMode;
  pinned?: boolean;
  order?: number;
}

export type BilinkType = 'manual' | 'ai-proposed' | 'ai-accepted';
export type BilinkCreator = 'user' | 'agent';

export interface Bilink {
  id: string;
  srcNoteId: string;
  dstNoteId: string;
  type: BilinkType;
  reason?: string;
  confidence?: number;
  createdAt: number;
  createdBy: BilinkCreator;
}

export type ProposalType =
  | 'link'
  | 'merge'
  | 'archive'
  | 'trigger'
  | 'review-card'
  | 'map-update';
export type ProposalStatus = 'pending' | 'accepted' | 'dismissed' | 'auto-applied';

export interface ProposalPayload {
  // link
  srcNoteId?: string;
  dstNoteId?: string;
  confidence?: number;
  // 生成方法（诚实标注）：embedding-cosine = 基于向量余弦相似度（非语义理解）；llm = 大模型生成
  method?: 'embedding-cosine' | 'llm';
  // merge
  noteIds?: string[];
  newTitle?: string;
  // archive
  noteId?: string;
  reason?: string;
  // trigger
  triggerDate?: string;
  relatedNoteIds?: string[];
  // review-card
  cards?: Array<{ front: string; back: string }>;
  // map-update
  weekKey?: string;
  nodes?: Array<{ id: string; label: string }>;
  edges?: Array<{ src: string; dst: string; weight: number }>;
}

export interface Proposal {
  id: string;
  type: ProposalType;
  status: ProposalStatus;
  payload: ProposalPayload;
  reason: string;
  confidence: number;
  createdAt: number;
  decidedAt?: number;
  agentRunId: string;
}

export type ReviewPreset = 'conservative' | 'standard' | 'aggressive';

// ts-fsrs 的 Card 类型在运行时由库构造；这里用兼容结构存储
export interface FsrsCardState {
  due: Date | number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3; // new=0, learning=1, review=2, relearning=3
  last_review: Date | number | null;
}

export interface ReviewCard {
  id: string;
  noteId: string;
  front: string;
  back: string;
  fsrsState: FsrsCardState;
  preset: ReviewPreset;
  createdAt: number;
  lastReviewAt?: number;
  nextReviewAt: number;
  lapses: number;
}

export interface Snapshot {
  id: string;
  noteId: string;
  content: string;
  createdAt: number;
  reason: 'auto' | 'manual' | 'pre-agent-apply' | 'pre-sync-conflict';
}

export type AgentRunTrigger = 'cron' | 'manual';
export type AgentRunStatus = 'running' | 'success' | 'failed';

export interface AgentRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  trigger: AgentRunTrigger;
  notesProcessed: number;
  proposalsCreated: number;
  tokensUsed: { input: number; output: number };
  cost: number;
  status: AgentRunStatus;
  error?: string;
}

// Agent 轨迹追踪（可观测性）
// 每次 runAgent 执行时记录一系列 step，用于：
//   - 复盘失败模式（哪个 step 出错、什么类型错误）
//   - 性能分析（哪个 step 慢、token 消耗分布）
//   - 回归对比（改 prompt/参数后某 step 的成功率变化）
export type AgentStepStatus = 'success' | 'failed' | 'skipped';

export type AgentStepType =
  | 'load-notes'        // 加载笔记
  | 'compute-similarity'// 计算嵌入相似度
  | 'check-bilink'      // 检查已有双链
  | 'create-proposal'   // 创建提议
  | 'llm-call'          // 调用 LLM
  | 'parse-response'    // 解析 LLM 响应
  | 'retry-llm';        // 重试 LLM

export interface AgentTrace {
  id: string;
  runId: string;            // 关联 AgentRun.id
  step: AgentStepType;      // 步骤类型
  status: AgentStepStatus;  // 步骤结果
  startedAt: number;        // 开始时间戳
  durationMs: number;       // 耗时毫秒
  // 上下文元数据（按 step 类型携带不同字段）
  meta?: {
    noteId?: string;        // 处理的笔记 ID
    proposalId?: string;    // 创建的提议 ID
    confidence?: number;    // 双链置信度
    attempt?: number;       // LLM 调用次数（含重试）
    tokensUsed?: number;    // token 消耗
    errorType?: string;     // 失败时的错误类型
    errorMessage?: string;  // 失败时的错误信息
    [k: string]: unknown;
  };
}

export type EmbeddingModel = 'bge-base-en-v1.5' | 'local-mini';
export type EmbeddingMode = 'local' | 'cloud';

export interface EmbeddingRecord {
  noteId: string;
  model: EmbeddingModel;
  vector: number[];
  contentHash: string;
  generatedAt: number;
  mode: EmbeddingMode;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

// 同步相关
export interface SyncDelta {
  noteId: string;
  rev: number;
  contentCipher: string;
  meta: string;
  updatedAt: number;
}

// 用户偏好
export interface UserPrefs {
  id: 'singleton';
  userId: string;
  masterKeyHash?: string;
  byokKeys?: Record<string, string>;
  modelRouting?: Record<string, string>;
  fsrsPreset: ReviewPreset;
  privacyMode: boolean;
  autoApplyProposals: boolean;
  createdAt: number;
  updatedAt: number;
}

// 笔记附件（图片/文件，Blob 存储在 IndexedDB）
export interface Attachment {
  id: string;
  noteId: string;
  filename: string;
  mime: string;
  size: number;
  blob: Blob;
  isImage: boolean;
  createdAt: number;
}
