import { clamp } from '../math';
import type { Needs } from '../types';

/**
 * Нужды и настроение (§5 ТЗ).
 *
 * Здесь живёт самый важный порог проекта: настроение не опускается ниже 20 никогда.
 * Это не баланс, а устав — грустный житель работает медленнее, но остров не сваливается
 * в спираль, из которой игрок не выберется.
 */

/** Жёсткий пол настроения. Меняться не может. */
export const MOOD_FLOOR = 20;

/** В отсутствие игрока настроение не падает ниже этого (устав, п. 5). */
export const MOOD_OFFLINE_FLOOR = 55;

/** Убыль за игровой час (§5 ТЗ). Укрытие бинарно и в этой таблице не участвует. */
export const NEED_DECAY_PER_HOUR: Readonly<Record<keyof Needs, number>> = {
  food: 4,
  rest: 3,
  shelter: 0,
  social: 2.5,
  beauty: 2,
  purpose: 2,
};

/** Веса при расчёте настроения (§5 ТЗ). В сумме единица. */
export const MOOD_WEIGHTS: Readonly<Record<keyof Needs, number>> = {
  food: 0.25,
  rest: 0.2,
  shelter: 0.15,
  social: 0.15,
  beauty: 0.1,
  purpose: 0.15,
};

/** За сколько игровых часов настроение догоняет положение дел (§5 ТЗ). */
export const MOOD_SMOOTHING_HOURS = 6;

export const NEED_KEYS: readonly (keyof Needs)[] = [
  'food',
  'rest',
  'shelter',
  'social',
  'beauty',
  'purpose',
];

export function fullNeeds(): Needs {
  return { food: 100, rest: 100, shelter: 0, social: 100, beauty: 100, purpose: 100 };
}

/** Убыль нужд за отрезок времени. Значения не выходят за 0..100. */
export function decayNeeds(needs: Needs, gameHours: number): Needs {
  const next = { ...needs };
  for (const key of NEED_KEYS) {
    next[key] = clamp(next[key] - NEED_DECAY_PER_HOUR[key] * gameHours, 0, 100);
  }
  return next;
}

/** Мгновенная оценка положения дел: взвешенное среднее нужд. */
export function rawMood(needs: Needs): number {
  let sum = 0;
  for (const key of NEED_KEYS) sum += clamp(needs[key], 0, 100) * MOOD_WEIGHTS[key];
  return sum;
}

/**
 * Настроение с плавным догоном и жёстким полом.
 *
 * Резкий скачок нужды не должен мгновенно менять лицо человека: настроение — это то,
 * как жизнь ощущается в целом, а не показание последнего датчика.
 */
export function smoothMood(previous: number, needs: Needs, gameHours: number): number {
  const target = rawMood(needs);
  const ease = 1 - Math.exp(-gameHours / MOOD_SMOOTHING_HOURS);
  const value = previous + (target - previous) * ease;
  return clamp(value, MOOD_FLOOR, 100);
}

export type MoodWord = 'светится' | 'радуется' | 'спокоен' | 'задумчив' | 'грустит';

/**
 * Настроение показывается словом, а не процентом (§8 ТЗ).
 * Процент превращает человека в шкалу, а игру — в таблицу.
 */
export function moodWord(mood: number): MoodWord {
  if (mood >= 85) return 'светится';
  if (mood >= 70) return 'радуется';
  if (mood >= 55) return 'спокоен';
  if (mood >= 40) return 'задумчив';
  return 'грустит';
}

/**
 * Эффективность работника (§4 ТЗ): 0.5…1.3 от настроения.
 * Ниже 0.5 не опускается никогда — второй жёсткий порог устава.
 */
export const WORKER_EFFICIENCY_FLOOR = 0.5;

export function workerEfficiency(mood: number, traitBonus = 0): number {
  const fromMood = 0.5 + (clamp(mood, 0, 100) / 100) * 0.7;
  return clamp(fromMood + traitBonus, WORKER_EFFICIENCY_FLOOR, 1.3);
}
