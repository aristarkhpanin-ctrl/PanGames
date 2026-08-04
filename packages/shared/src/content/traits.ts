import type { AgentState, TraitId } from '../types';

/**
 * Двенадцать черт характера (§5 ТЗ). Житель получает ровно две.
 *
 * Черта меняет веса при выборе действия и даёт прибавку к профильной работе.
 * Это данные, а не код: новая черта — запись в этом списке.
 */

export interface Trait {
  id: TraitId;
  name: string;
  /** Как черта тянет житель к тем или иным занятиям. 1 — без влияния. */
  weights: Partial<Record<AgentState, number>>;
  /** Сдвиг распорядка в часах: сова встаёт позже, ранняя пташка раньше. */
  scheduleShift?: number;
  /** Работает ли ночью (§3 ТЗ: ночью трудятся только совы). */
  nocturnal?: boolean;
}

/** Прибавка к профильной работе от подходящей черты (§5 ТЗ). */
export const TRAIT_WORK_BONUS = 0.15;

export const TRAITS: readonly Trait[] = [
  { id: 'early_bird', name: 'ранняя пташка', weights: { work: 1.1 }, scheduleShift: -1.5 },
  { id: 'night_owl', name: 'сова', weights: { admire: 1.2 }, scheduleShift: 2, nocturnal: true },
  { id: 'hard_worker', name: 'трудяга', weights: { work: 1.35, build: 1.25, idle: 0.7 } },
  { id: 'dreamer', name: 'мечтатель', weights: { admire: 1.5, wander: 1.2, work: 0.85 } },
  { id: 'gardener', name: 'садовник', weights: { work: 1.15, admire: 1.2 } },
  { id: 'fisher', name: 'рыбак', weights: { work: 1.2 } },
  { id: 'homebody', name: 'домосед', weights: { sleep: 1.2, wander: 0.6 } },
  { id: 'wanderer', name: 'странник', weights: { wander: 1.6, admire: 1.15, sleep: 0.9 } },
  { id: 'cheerful', name: 'весельчак', weights: { socialize: 1.5, celebrate: 1.4 } },
  { id: 'quiet', name: 'тихоня', weights: { socialize: 0.6, admire: 1.3 } },
  { id: 'tidy', name: 'аккуратист', weights: { build: 1.2, haul: 1.3 } },
  { id: 'collector', name: 'коллекционер', weights: { wander: 1.25, haul: 1.2 } },
];

const BY_ID = new Map(TRAITS.map((trait) => [trait.id, trait]));

export function trait(id: TraitId): Trait | undefined {
  return BY_ID.get(id);
}

/** Общий вес пары черт для действия. Единица означает «черты тут ни при чём». */
export function traitWeight(traits: readonly TraitId[], state: AgentState): number {
  let weight = 1;
  for (const id of traits) weight *= trait(id)?.weights[state] ?? 1;
  return weight;
}

export function scheduleShift(traits: readonly TraitId[]): number {
  let shift = 0;
  for (const id of traits) shift += trait(id)?.scheduleShift ?? 0;
  return shift;
}

export function worksAtNight(traits: readonly TraitId[]): boolean {
  return traits.some((id) => trait(id)?.nocturnal === true);
}
