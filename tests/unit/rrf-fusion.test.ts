// 单测：RRF 融合（recall 检索的核心融合算法）
import { describe, it, expect } from 'vitest';
import { rrfFusion } from '@/lib/ai/search';

function topScores(map: ReturnType<typeof rrfFusion>, k = 3) {
  return [...map.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, k)
    .map(([id, info]) => ({
      id,
      score: Number(info.score.toFixed(6)),
      matchedBy: info.sources.length === 2 ? 'both' : info.sources[0],
    }));
}

describe('rrfFusion', () => {
  it('单列表：分数随排名递减', () => {
    const map = rrfFusion(['n1', 'n2', 'n3'], []);
    const top = topScores(map);
    expect(top[0]).toMatchObject({ id: 'n1', matchedBy: 'keyword' });
    expect(top[0].score).toBeGreaterThan(top[1].score);
    expect(top[1].score).toBeGreaterThan(top[2].score);
  });

  it('双列表重叠：重叠项分数叠加，标记为 both', () => {
    const map = rrfFusion(['n1', 'n2'], ['n2', 'n3']);
    const top = topScores(map);
    // n2 在两组都第一（i=0）→ 1/60 + 1/60
    const n2 = top.find((t) => t.id === 'n2');
    expect(n2?.matchedBy).toBe('both');
    // n2 在 A 组排第 2（i=1 → 1/61），在 B 组排第 1（i=0 → 1/60）
    expect(n2?.score).toBe(Number((1 / 61 + 1 / 60).toFixed(6)));
    // n1 / n3 只在单组，分数为 1/61（第二组 i=1）或 1/60（第一组 i=0）
    expect(top.find((t) => t.id === 'n1')?.matchedBy).toBe('keyword');
    expect(top.find((t) => t.id === 'n3')?.matchedBy).toBe('semantic');
  });

  it('空输入：返回空 map', () => {
    const map = rrfFusion([], []);
    expect(map.size).toBe(0);
  });

  it('k 参数影响分数尺度（k 越大，绝对分数越小但对靠后排名惩罚更轻）', () => {
    const small = rrfFusion(['a', 'b'], []) as ReturnType<typeof rrfFusion>;
    const large = rrfFusion(['a', 'b'], [], 200) as ReturnType<typeof rrfFusion>;
    // 第一名绝对分数 1/k 随 k 增大而减小
    expect(large.get('a')!.score).toBeLessThan(small.get('a')!.score);
    // 但 a、b 之间的相对差距在 k 更大时更小（靠后排名惩罚更轻）
    const diffSmall = small.get('a')!.score - small.get('b')!.score;
    const diffLarge = large.get('a')!.score - large.get('b')!.score;
    expect(diffLarge).toBeLessThan(diffSmall);
  });

  it('结果可按分数排序，both 优先于单来源', () => {
    // n1 两组第一重叠；n2 仅关键词第一
    const map = rrfFusion(['n1', 'n2'], ['n1']);
    const top = topScores(map, 2);
    expect(top[0].id).toBe('n1');
    expect(top[0].matchedBy).toBe('both');
  });
});
