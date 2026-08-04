/**
 * Детерминированный генератор псевдослучайных чисел.
 *
 * Весь проект обязан получать одинаковый мир из одинакового сида — иначе клиент и сервер
 * разойдутся в расчётах, и обнаружится это уже на живом сервере. Поэтому `Math.random()`
 * в `packages/shared` запрещён линтером, а случайность приходит отсюда.
 *
 * Алгоритм — mulberry32: 32 бита состояния, хорошее качество на наших задачах, полностью
 * переносим между движками (никакой зависимости от порядка операций с плавающей точкой).
 */

export interface Rng {
  /** Следующее целое в диапазоне 32-битного беззнакового. */
  nextUint32(): number;
  /** Число в [0, 1). */
  float(): number;
  /** Число в [min, max). */
  range(min: number, max: number): number;
  /** Целое в [min, max], границы включены. */
  int(min: number, max: number): number;
  /** Случайный элемент непустого массива. */
  pick<T>(items: readonly [T, ...T[]]): T;
  /** Истина с заданной вероятностью (0..1). */
  chance(probability: number): boolean;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  const float = (): number => nextUint32() / 0x1_0000_0000;

  return {
    nextUint32,
    float,
    range: (min, max) => min + float() * (max - min),
    int: (min, max) => min + Math.floor(float() * (max - min + 1)),
    pick: (items) => items[Math.floor(float() * items.length)] ?? items[0],
    chance: (probability) => float() < probability,
  };
}

/**
 * Производит независимый сид из основного и текстовой метки.
 *
 * Нужен, чтобы разные этапы генерации не тянули числа из одного потока: иначе правка формы
 * берега сдвинет вообще всё, включая имена жителей. С отдельными сидами каждый этап
 * воспроизводится независимо от остальных.
 */
export function deriveSeed(seed: number, label: string): number {
  let hash = seed >>> 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  // Финальное перемешивание, чтобы близкие метки не давали близкие сиды.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}
