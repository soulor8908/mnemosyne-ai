// 核心类型定义（对齐技术设计文档第 3 节）

export type NoteStatus = 'draft' | 'settled' | 'archived';
export type NoteSource = 'manual' | 'clip' | 'voice' | 'bot' | 'email' | 'import';
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
  };
  createdAt: number;
  updatedAt: number;
  accessedAt: number;
  rev: number;
  syncStatus: SyncStatus;
  encryption: EncryptionMode;
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
  reason: 'auto' | 'manual' | 'pre-agent-apply';
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
