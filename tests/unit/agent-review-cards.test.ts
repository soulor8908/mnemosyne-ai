// 单测：Agent 复习卡输出解析（Zod 校验，替代正则裸解析）
import { describe, it, expect } from 'vitest';
import { parseReviewCards } from '@/lib/ai/agent/runner';

describe('parseReviewCards', () => {
  it('解析纯 JSON 数组', () => {
    const r = parseReviewCards('[{"front":"Q","back":"A"}]');
    expect(r?.cards).toEqual([{ front: 'Q', back: 'A' }]);
  });

  it('容忍 LLM 前后冗余文字', () => {
    const text =
      '好的，这是复习卡：\n[{"front":"什么是 RRF","back":"倒数排名融合"}]\n希望对你有帮助';
    const r = parseReviewCards(text);
    expect(r?.cards.length).toBe(1);
    expect(r?.cards[0].back).toBe('倒数排名融合');
  });

  it('缺字段返回 null（Zod 拦截）', () => {
    expect(parseReviewCards('[{"front":"只有问题"}]')).toBeNull();
  });

  it('非数组返回 null', () => {
    expect(parseReviewCards('{"front":"Q","back":"A"}')).toBeNull();
  });

  it('空数组也视为合法', () => {
    const r = parseReviewCards('[]');
    expect(r?.cards).toEqual([]);
  });

  it('完全无 JSON 返回 null', () => {
    expect(parseReviewCards('今天天气不错')).toBeNull();
  });
});
