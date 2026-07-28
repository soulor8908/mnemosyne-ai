// FSRS 复习调度
import { fsrs, generatorParameters, createEmptyCard, type Card, type Grade } from 'ts-fsrs';
import type { ReviewPreset, FsrsCardState, ReviewCard } from '@/types';
import { genId, now } from '@/lib/utils';
import { getDb } from '@/lib/db/schema';
import { getOrCreateUserPrefs } from '@/lib/auth/user-prefs';

// 3 种预设（对齐技术设计文档，参数名用下划线）
const PRESETS: Record<ReviewPreset, Partial<import('ts-fsrs').FSRSParameters>> = {
  conservative: { request_retention: 0.95, maximum_interval: 36500 },
  standard: { request_retention: 0.9, maximum_interval: 36500 },
  aggressive: { request_retention: 0.8, maximum_interval: 36500 },
};

const fsrsInstances: Record<ReviewPreset, ReturnType<typeof fsrs>> = {
  conservative: fsrs(generatorParameters(PRESETS.conservative)),
  standard: fsrs(generatorParameters(PRESETS.standard)),
  aggressive: fsrs(generatorParameters(PRESETS.aggressive)),
};

export function getFsrs(preset: ReviewPreset) {
  return fsrsInstances[preset];
}

// 新卡片初始状态
export function createNewCard(_preset: ReviewPreset): Card {
  return createEmptyCard(new Date());
}

// card <-> FsrsCardState 序列化
export function cardToState(card: Card): FsrsCardState {
  return {
    due: card.due instanceof Date ? card.due.getTime() : card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as 0 | 1 | 2 | 3,
    last_review: card.last_review instanceof Date ? card.last_review.getTime() : card.last_review ?? null,
  };
}

export function stateToCard(state: FsrsCardState): Card {
  return {
    due: typeof state.due === 'number' ? new Date(state.due) : state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review:
      state.last_review === null || state.last_review === undefined
        ? undefined
        : typeof state.last_review === 'number'
          ? new Date(state.last_review)
          : state.last_review,
  } as Card;
}

// 评分后更新卡片
export async function reviewCard(
  cardId: string,
  rating: Grade
): Promise<ReviewCard | undefined> {
  const db = getDb();
  const card = await db.reviewCards.get(cardId);
  if (!card) return undefined;

  const f = getFsrs(card.preset);
  const currentCard = stateToCard(card.fsrsState);
  const preview = f.repeat(currentCard, new Date());
  const result = preview[rating];
  const newCard = result.card;

  const updated: ReviewCard = {
    ...card,
    fsrsState: cardToState(newCard),
    lastReviewAt: now(),
    nextReviewAt: newCard.due instanceof Date ? newCard.due.getTime() : Date.now(),
    lapses: newCard.lapses,
  };
  await db.reviewCards.put(updated);
  return updated;
}

// 获取今日待复习卡片
export async function getTodayReviewQueue(): Promise<ReviewCard[]> {
  const db = getDb();
  const prefs = await getOrCreateUserPrefs();
  const nowTs = now();
  const cards = await db.reviewCards
    .where('nextReviewAt')
    .belowOrEqual(nowTs + 24 * 3600 * 1000)
    .toArray();
  return cards.filter((c) => c.preset === prefs.fsrsPreset);
}

// 为笔记生成复习卡
export async function generateReviewCard(
  noteId: string,
  front: string,
  back: string
): Promise<ReviewCard> {
  const db = getDb();
  const prefs = await getOrCreateUserPrefs();
  const card = createNewCard(prefs.fsrsPreset);
  const reviewCard: ReviewCard = {
    id: genId('card'),
    noteId,
    front,
    back,
    fsrsState: cardToState(card),
    preset: prefs.fsrsPreset,
    createdAt: now(),
    nextReviewAt: card.due instanceof Date ? card.due.getTime() : now(),
    lapses: 0,
  };
  await db.reviewCards.add(reviewCard);
  return reviewCard;
}

// 统计复习热力图数据
export async function getReviewHeatmap(days = 365): Promise<Array<{ date: string; count: number }>> {
  const db = getDb();
  const since = now() - days * 24 * 3600 * 1000;
  const cards = await db.reviewCards
    .where('lastReviewAt')
    .above(since)
    .toArray();

  const counts = new Map<string, number>();
  for (const card of cards) {
    if (!card.lastReviewAt) continue;
    const dateStr = new Date(card.lastReviewAt).toISOString().slice(0, 10);
    counts.set(dateStr, (counts.get(dateStr) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
