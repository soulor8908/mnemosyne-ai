// 单测：FSRS 调度器（复习闭环的算法核心）
import { describe, it, expect } from 'vitest';
import { Rating } from 'ts-fsrs';
import {
  createNewCard,
  cardToState,
  stateToCard,
  getFsrs,
  generateReviewCard,
  reviewCard,
  getTodayReviewQueue,
} from '@/lib/fsrs/scheduler';
import { getDb } from '@/lib/db/schema';
import type { ReviewPreset } from '@/types';

const PRESETS: ReviewPreset[] = ['conservative', 'standard', 'aggressive'];

describe('FSRS card 序列化往返', () => {
  it('cardToState → stateToCard 保持关键字段', async () => {
    for (const preset of PRESETS) {
      const card = await createNewCard(preset);
      const state = cardToState(card);
      const back = stateToCard(state);
      // due Date 往返
      expect(back.due instanceof Date).toBe(true);
      expect((back.due as Date).getTime()).toBe((card.due as Date).getTime());
      expect(back.stability).toBe(card.stability);
      expect(back.difficulty).toBe(card.difficulty);
      expect(back.reps).toBe(card.reps);
      expect(back.lapses).toBe(card.lapses);
      expect(back.state).toBe(card.state);
    }
  });

  it('同一卡片不同评分产生不同调度（Easy 间隔 > Good > Again）', async () => {
    const f = await getFsrs('standard');
    const card = await createNewCard('standard');
    const r = f.repeat(card, new Date());
    const againDue = r[Rating.Again].card.due.getTime();
    const goodDue = r[Rating.Good].card.due.getTime();
    const easyDue = r[Rating.Easy].card.due.getTime();
    expect(goodDue).toBeGreaterThan(againDue);
    expect(easyDue).toBeGreaterThan(goodDue);
  });
});

describe('FSRS 复习卡生命周期', () => {
  it('generateReviewCard 创建一张新卡（state=new）', async () => {
    const card = await generateReviewCard('note_1', '什么是 RRF？', '倒数排名融合');
    expect(card.id).toBeTruthy();
    expect(card.noteId).toBe('note_1');
    expect(card.front).toBe('什么是 RRF？');
    expect(card.back).toBe('倒数排名融合');
    expect(card.fsrsState.state).toBe(0); // new
    expect(card.nextReviewAt).toBeGreaterThan(0);
  });

  it('reviewCard 评分后更新调度并推进 due', async () => {
    const card = await generateReviewCard('note_2', 'Q', 'A');
    const before = card.nextReviewAt;
    const updated = await reviewCard(card.id, Rating.Good);
    expect(updated).toBeDefined();
    expect(updated!.fsrsState.reps).toBe(1);
    // Good 评分后 due 应推到未来
    expect(updated!.nextReviewAt).toBeGreaterThan(before);
  });

  it('getTodayReviewQueue 返回到期（nextReviewAt <= now+24h）的卡片', async () => {
    const db = getDb();
    // 直接构造一张已到期的卡，隔离 FSRS 间隔计算的魔法数字
    const card = await generateReviewCard('note_queue', 'Qq', 'Aa');
    await db.reviewCards.update(card.id, { nextReviewAt: Date.now() - 1000 });
    const queue = await getTodayReviewQueue();
    expect(queue.some((c) => c.noteId === 'note_queue')).toBe(true);
  });

  it('getTodayReviewQueue 按 preset 过滤（不返回其他 preset 的卡）', async () => {
    const db = getDb();
    const card = await generateReviewCard('note_other_preset', 'Qo', 'Ao');
    await db.reviewCards.update(card.id, { nextReviewAt: Date.now() - 1000, preset: 'aggressive' });
    // 用户默认 preset 为 standard；aggressive 的到期卡不应出现
    const queue = await getTodayReviewQueue();
    expect(queue.some((c) => c.noteId === 'note_other_preset')).toBe(false);
  });
});
