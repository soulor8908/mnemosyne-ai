// Zod schemas：AI 输入输出边界校验（技术设计文档 3.3）
import { z } from 'zod';

export const ProposalSchema = z.object({
  type: z.enum(['link', 'merge', 'archive', 'trigger', 'review-card', 'map-update']),
  payload: z.union([
    z.object({
      srcNoteId: z.string(),
      dstNoteId: z.string(),
      confidence: z.number().min(0).max(1),
    }),
    z.object({
      noteIds: z.array(z.string()).min(2),
      newTitle: z.string(),
    }),
    z.object({
      noteId: z.string(),
      reason: z.string(),
    }),
    z.object({
      noteId: z.string(),
      triggerDate: z.string(),
      relatedNoteIds: z.array(z.string()),
    }),
    z.object({
      noteId: z.string(),
      cards: z.array(z.object({ front: z.string(), back: z.string() })).min(1),
    }),
    z.object({
      weekKey: z.string(),
      nodes: z.array(z.object({ id: z.string(), label: z.string() })),
      edges: z.array(z.object({ src: z.string(), dst: z.string(), weight: z.number() })),
    }),
  ]),
  reason: z.string().min(20),
  confidence: z.number().min(0).max(1),
});

export const ChatResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      noteId: z.string(),
      quote: z.string(),
      relevance: z.number(),
    })
  ).max(5),
});

export const EmbeddingResponseSchema = z.object({
  vector: z.array(z.number()),
  model: z.string(),
  dim: z.number(),
});

export const CreateNoteSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().max(5_000_000),
  folderId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  source: z.enum(['manual', 'clip', 'voice', 'bot', 'email', 'import']).optional(),
});

export const UpdateNoteSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().max(5_000_000).optional(),
  tags: z.array(z.string()).optional(),
  folderId: z.string().nullable().optional(),
  status: z.enum(['draft', 'settled', 'archived']).optional(),
  frontmatter: z.record(z.unknown()).optional(),
});

export const SyncRequestSchema = z.object({
  sinceRev: z.number().int().min(0).optional(),
  masterKey: z.string().optional(),
});

export const ReviewRequestSchema = z.object({
  cardId: z.string(),
  rating: z.enum(['again', 'hard', 'good', 'easy']),
});

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(20).optional(),
});

export const ByokKeySchema = z.object({
  provider: z.enum(['deepseek', 'glm', 'openai']),
  apiKey: z.string().min(1),
});

export const MasterKeyInitSchema = z.object({
  masterKey: z.string().min(16),
});

export type ProposalInput = z.infer<typeof ProposalSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
