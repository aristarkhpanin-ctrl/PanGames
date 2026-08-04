import { describe, expect, it } from 'vitest';

import { createRng, deriveSeed } from './rng';

describe('createRng', () => {
  it('из одного сида выдаёт одну и ту же последовательность', () => {
    const a = createRng(2026);
    const b = createRng(2026);
    const first = Array.from({ length: 64 }, () => a.nextUint32());
    const second = Array.from({ length: 64 }, () => b.nextUint32());
    expect(first).toEqual(second);
  });

  it('совпадает с эталоном — алгоритм нельзя менять незаметно', () => {
    // Если этот тест упал, изменился сам PRNG. Это ломает все существующие острова:
    // мир восстанавливается из сида, а не хранится целиком.
    const rng = createRng(12345);
    expect(Array.from({ length: 6 }, () => rng.nextUint32())).toEqual([
      4207900869, 1317490944, 2079646450, 3513001552, 2187978186, 1492380277,
    ]);
  });

  it('разные сиды дают разные последовательности', () => {
    const draw = (seed: number): number[] => {
      const rng = createRng(seed);
      return Array.from({ length: 32 }, () => rng.nextUint32());
    };
    expect(draw(1)).not.toEqual(draw(2));
  });

  it('float лежит в [0, 1) и распределён ровно', () => {
    // Проверка накапливается и сверяется один раз: expect внутри цикла на сотнях тысяч
    // итераций упирается в таймаут теста, ничего не проверяя дополнительно.
    const rng = createRng(99);
    let sum = 0;
    let outOfRange = 0;
    const samples = 200_000;
    for (let i = 0; i < samples; i += 1) {
      const value = rng.float();
      if (value < 0 || value >= 1) outOfRange += 1;
      sum += value;
    }
    expect(outOfRange).toBe(0);
    expect(sum / samples).toBeCloseTo(0.5, 2);
  });

  it('int включает обе границы и за них не выходит', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    let invalid = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const value = rng.int(3, 7);
      if (!Number.isInteger(value) || value < 3 || value > 7) invalid += 1;
      seen.add(value);
    }
    expect(invalid).toBe(0);
    expect([...seen].sort((x, y) => x - y)).toEqual([3, 4, 5, 6, 7]);
  });

  it('int работает на вырожденном диапазоне', () => {
    const rng = createRng(5);
    expect(rng.int(4, 4)).toBe(4);
  });

  it('pick возвращает элемент массива и перебирает все', () => {
    const rng = createRng(11);
    const items = ['песок', 'трава', 'камень'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(rng.pick(items));
    expect(seen.size).toBe(3);
  });

  it('chance держит заданную вероятность', () => {
    const rng = createRng(13);
    let hits = 0;
    const samples = 100_000;
    for (let i = 0; i < samples; i += 1) if (rng.chance(0.25)) hits += 1;
    expect(hits / samples).toBeCloseTo(0.25, 2);
  });
});

describe('deriveSeed', () => {
  it('детерминирован', () => {
    expect(deriveSeed(12345, 'coast')).toBe(deriveSeed(12345, 'coast'));
  });

  it('совпадает с эталоном', () => {
    expect(['coast', 'height', 'biome'].map((label) => deriveSeed(12345, label))).toEqual([
      3159631691, 1374783424, 2816020301,
    ]);
  });

  it('разводит близкие метки и близкие сиды', () => {
    // Иначе правка одного этапа генерации сдвинула бы все остальные.
    expect(deriveSeed(1, 'coast')).not.toBe(deriveSeed(1, 'coasu'));
    expect(deriveSeed(1, 'coast')).not.toBe(deriveSeed(2, 'coast'));
  });

  it('выдаёт 32-битное беззнаковое', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const derived = deriveSeed(seed, 'резкая метка');
      expect(Number.isInteger(derived)).toBe(true);
      expect(derived).toBeGreaterThanOrEqual(0);
      expect(derived).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
