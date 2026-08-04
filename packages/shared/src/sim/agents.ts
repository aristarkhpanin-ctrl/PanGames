import { traitWeight, worksAtNight } from '../content/traits';
import { distance2D } from '../math';
import type { AgentState, Needs, TraitId, Vec3, Villager } from '../types';
import { WORLD_X, WORLD_Z, columnIndex } from '../voxels';
import type { Rng } from '../worldgen/rng';
import { isWalkable, type NavGrid } from './navigation';
import { DAWN_HOUR, DUSK_HOUR } from './time';

/**
 * Выбор действия (§5 ТЗ). Utility-подход поверх простого автомата состояний.
 *
 * Ключ к «живости» — не сложность ИИ, а читаемость: игрок должен по позе и месту понимать,
 * что человек делает. Поэтому действий немного, каждое узнаваемо, и однажды выбранное
 * доводится до конца.
 */

/** Нужда, которую закрывает действие. */
const NEED_OF_ACTION: Partial<Record<AgentState, keyof Needs>> = {
  eat: 'food',
  sleep: 'rest',
  socialize: 'social',
  admire: 'beauty',
  work: 'purpose',
};

/** Сколько тиков занимает действие, когда житель до него дошёл. */
const ACTION_TICKS: Partial<Record<AgentState, number>> = {
  eat: 3,
  sleep: 12,
  socialize: 6,
  admire: 6,
  work: 9,
  wander: 6,
  idle: 3,
};

/** Насколько быстро действие закрывает свою нужду — единиц за тик. */
const RESTORE_PER_TICK: Partial<Record<AgentState, number>> = {
  eat: 22,
  sleep: 9,
  socialize: 12,
  admire: 11,
  work: 8,
};

/** Действия, которые житель вообще может выбрать на этом этапе. */
const CANDIDATES: readonly AgentState[] = ['eat', 'sleep', 'socialize', 'admire', 'work', 'wander'];

/** Как далеко житель забредает от того места, где стоит. */
const WANDER_RADIUS = 26;

export interface AgentContext {
  grid: NavGrid;
  hour: number;
  tick: number;
  villagers: readonly Villager[];
  /** Клетки, на которые приятно смотреть: берег и диковинка. Заполняется генератором острова. */
  scenicSpots: readonly Vec3[];
}

export interface ChosenAction {
  state: AgentState;
  target?: Vec3;
  ticks: number;
}

/**
 * Вес действия по времени суток. Ночью зовёт спать, днём — работать,
 * вечером — сидеть вместе, на рассвете и закате — смотреть по сторонам.
 */
function timeOfDayWeight(state: AgentState, hour: number, traits: readonly TraitId[]): number {
  const night = hour < DAWN_HOUR || hour >= DUSK_HOUR + 2;

  switch (state) {
    case 'sleep':
      return night ? 3.2 : 0.15;
    case 'work':
      if (night) return worksAtNight(traits) ? 0.8 : 0.05;
      return hour >= 8 && hour <= 17 ? 1.3 : 0.8;
    case 'socialize':
      return hour >= DUSK_HOUR - 3 && hour < DUSK_HOUR + 2 ? 1.6 : night ? 0.2 : 0.9;
    case 'admire':
      // Рассвет и закат — то время, ради которого стоит поднять голову.
      if (Math.abs(hour - DAWN_HOUR) < 1.5 || Math.abs(hour - DUSK_HOUR) < 1.5) return 1.8;
      return night ? 0.3 : 0.9;
    case 'eat':
      return night ? 0.3 : 1;
    default:
      return night ? 0.25 : 1;
  }
}

/**
 * Полезность действия по формуле §5 ТЗ:
 * `deficit^1.5 × trait × time × (1 / (1 + distance / 20)) + небольшая случайность`.
 */
export function scoreAction(
  villager: Villager,
  state: AgentState,
  target: Vec3 | undefined,
  context: AgentContext,
  rng: Rng,
): number {
  const need = NEED_OF_ACTION[state];
  // У прогулки нет своей нужды: ей даётся ровный средний вес, чтобы она не выигрывала
  // у настоящих потребностей, но и не пропадала совсем.
  const deficit =
    need === undefined ? 0.35 : 1 - Math.max(0, Math.min(100, villager.needs[need])) / 100;

  return (
    Math.pow(deficit, 1.5) *
      traitWeight(villager.traits, state) *
      timeOfDayWeight(state, context.hour, villager.traits) *
      (1 / (1 + distanceToTarget(villager, target) / 20)) +
    rng.range(0, 0.05)
  );
}

function distanceToTarget(villager: Villager, target: Vec3 | undefined): number {
  if (target === undefined) return 0;
  return distance2D(villager.position.x, villager.position.z, target.x, target.z);
}

/**
 * Выбирает, чем житель займётся. Берётся максимум по полезности; выбранное действие
 * фиксируется на своё число тиков и не пересматривается каждый тик.
 */
export function chooseAction(villager: Villager, context: AgentContext, rng: Rng): ChosenAction {
  let best: ChosenAction = { state: 'idle', ticks: ACTION_TICKS.idle ?? 3 };
  let bestScore = -Infinity;

  for (const state of CANDIDATES) {
    const target = pickTarget(villager, state, context, rng);
    // Не с кем поговорить или некуда пойти — действие просто не рассматривается.
    if (target === null) continue;

    const score = scoreAction(villager, state, target ?? undefined, context, rng);
    if (score <= bestScore) continue;

    bestScore = score;
    best = {
      state,
      ...(target === undefined ? {} : { target }),
      ticks: ACTION_TICKS[state] ?? 4,
    };
  }

  return best;
}

/**
 * Куда идти ради действия. `undefined` — оставаться на месте, `null` — действие сейчас
 * невозможно (не с кем поговорить, некуда забрести).
 */
function pickTarget(
  villager: Villager,
  state: AgentState,
  context: AgentContext,
  rng: Rng,
): Vec3 | undefined | null {
  switch (state) {
    case 'socialize': {
      const others = context.villagers.filter((other) => other.id !== villager.id);
      if (others.length === 0) return null;
      return others[rng.int(0, others.length - 1)]?.position ?? null;
    }

    case 'admire': {
      if (context.scenicSpots.length === 0) return null;
      return context.scenicSpots[rng.int(0, context.scenicSpots.length - 1)] ?? null;
    }

    case 'wander':
    case 'work':
      return randomNearbyCell(villager, context, rng);

    default:
      // Есть и спать можно там, где стоишь: домов и очага на этом этапе ещё нет.
      return undefined;
  }
}

function randomNearbyCell(villager: Villager, context: AgentContext, rng: Rng): Vec3 | null {
  const from = villager.position;

  // Несколько попыток вслепую дешевле, чем перебор всех проходимых клеток вокруг.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const x = Math.round(from.x + rng.range(-WANDER_RADIUS, WANDER_RADIUS));
    const z = Math.round(from.z + rng.range(-WANDER_RADIUS, WANDER_RADIUS));
    if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) continue;
    if (!isWalkable(context.grid, x, z)) continue;

    const height = context.grid.height[columnIndex(x, z)] ?? 0;
    return { x, y: height + 1, z };
  }

  return null;
}

export { ACTION_TICKS, NEED_OF_ACTION, RESTORE_PER_TICK };
