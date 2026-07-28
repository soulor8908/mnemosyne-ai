import Dexie, { type Table } from 'dexie';
import type {
  Note,
  Bilink,
  Proposal,
  ReviewCard,
  Snapshot,
  AgentRun,
  EmbeddingRecord,
  Folder,
  UserPrefs,
} from '@/types';

export class MnemosyneDB extends Dexie {
  notes!: Table<Note, string>;
  bilinks!: Table<Bilink, string>;
  proposals!: Table<Proposal, string>;
  reviewCards!: Table<ReviewCard, string>;
  snapshots!: Table<Snapshot, string>;
  agentRuns!: Table<AgentRun, string>;
  embeddings!: Table<EmbeddingRecord, string>;
  folders!: Table<Folder, string>;
  userPrefs!: Table<UserPrefs, string>;

  constructor() {
    super('mnemosyne');
    this.version(1).stores({
      notes: 'id, title, folderId, status, source, createdAt, updatedAt, accessedAt, syncStatus, *tags',
      bilinks: 'id, srcNoteId, dstNoteId, type, createdAt',
      proposals: 'id, type, status, createdAt, agentRunId',
      reviewCards: 'id, noteId, preset, nextReviewAt, lastReviewAt',
      snapshots: 'id, noteId, createdAt',
      agentRuns: 'id, startedAt, trigger, status',
      embeddings: 'noteId, model, contentHash, generatedAt',
      folders: 'id, name, parentId, createdAt, updatedAt',
      userPrefs: 'id',
    });
  }
}

// 单例（浏览器环境）
let _db: MnemosyneDB | null = null;

export function getDb(): MnemosyneDB {
  if (!_db) {
    _db = new MnemosyneDB();
  }
  return _db;
}

// 测试用：重置单例
export function _resetDbForTests() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
