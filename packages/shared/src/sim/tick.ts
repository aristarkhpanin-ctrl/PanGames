import { clamp } from '../math';
import type { AgentState, Vec3, Villager } from '../types';
import { columnIndex } from '../voxels';
import { createRng, deriveSeed, type Rng } from '../worldgen/rng';
import { chooseAction, NEED_OF_ACTION, RESTORE_PER_TICK, type AgentContext } from './agents';
import { findPath, isWalkable, type NavGrid } from './navigation';
import { decayNeeds, MOOD_FLOOR, smoothMood } from './needs';
import { GAME_MINUTES_PER_TICK, hourOfTick } from './time';

/**
 * Один тик симуляции: 10 игровых минут (§3 ТЗ).
 *
 * Функция чистая — на вход состояние, на выход новое состояние и список событий.
 * Ни времени, ни случайности изнутри: и то и другое приходит аргументами, иначе клиент
 * и сервер разойдутся в расчётах.
 */

export interface SimState {
  tick: number;
  villagers: Villager[];
}

export type SimEventKind = 'arrived' | 'action_started' | 'path_failed';

export interface SimEvent {
  kind: SimEventKind;
  villagerId: string;
  state?: AgentState;
}

export interface TickInput {
  grid: NavGrid;
  /** Красивые места: берег, диковинка. Туда ходят любоваться. */
  scenicSpots: readonly Vec3[];
  /** Сид острова — из него выводится случайность тика. */
  seed: number;
}

/** Сколько клеток житель проходит за тик. Неспешный шаг: игра про спокойствие. */
const CELLS_PER_TICK = 8;

/**
 * Сколько путей разрешено искать за один тик (§12 ТЗ).
 * Остальные подождут следующего: житель без пути стоит, а не телепортируется.
 */
export const PATH_BUDGET_PER_TICK = 5;

export function simulateTick(
  state: SimState,
  input: TickInput,
): { state: SimState; events: SimEvent[] } {
  const tick = state.tick + 1;
  const hour = hourOfTick(tick);
  const rng = createRng(deriveSeed(input.seed, `tick:${String(tick)}`));
  const events: SimEvent[] = [];

  const context: AgentContext = {
    grid: input.grid,
    hour,
    tick,
    villagers: state.villagers,
    scenicSpots: input.scenicSpots,
  };

  let pathsLeft = PATH_BUDGET_PER_TICK;
  const villagers = state.villagers.map((villager) => {
    const next = { ...villager, needs: decayNeeds(villager.needs, GAME_MINUTES_PER_TICK / 60) };

    // Укрытие бинарно: дома появятся на M4, до тех пор все ночуют под открытым небом.
    next.needs.shelter = next.homeId === undefined ? 0 : 100;

    const moved = advance(next, input.grid);
    if (moved === 'arrived') events.push({ kind: 'arrived', villagerId: next.id });

    const busy = (next.busyUntilTick ?? 0) > tick;
    const walking = next.state === 'walk' && next.target !== undefined;

    if (!busy && !walking) {
      const chosen = chooseAction(next, context, rng);
      applyChoice(next, chosen, tick, input.grid, rng, () => {
        if (pathsLeft <= 0) return false;
        pathsLeft -= 1;
        return true;
      });
      events.push({ kind: 'action_started', villagerId: next.id, state: next.state });
    }

    restoreNeed(next);
    next.mood = smoothMood(next.mood, next.needs, GAME_MINUTES_PER_TICK / 60);
    // Пол настроения — устав, а не баланс. Проверяем ещё раз после всех расчётов.
    next.mood = clamp(next.mood, MOOD_FLOOR, 100);

    return next;
  });

  return { state: { tick, villagers }, events };
}

/** Продвигает жителя по пути. Возвращает «arrived», если дошёл на этом тике. */
function advance(villager: Villager, grid: NavGrid): 'moving' | 'arrived' | 'idle' {
  const path = villager.path;
  if (path === undefined || path.length === 0) return 'idle';

  let index = villager.pathIndex ?? 0;
  index = Math.min(index + CELLS_PER_TICK, path.length - 1);
  const cell = path[index];

  if (cell !== undefined) {
    villager.position = cell;
    villager.pathIndex = index;
  }

  if (index >= path.length - 1) {
    delete villager.path;
    delete villager.pathIndex;
    delete villager.target;
    // Дошёл — теперь можно и заняться тем, ради чего шёл.
    if (villager.state === 'walk') villager.state = 'idle';
    // Высота могла измениться: встаём на поверхность, а не в воздух.
    const height = grid.height[columnIndex(villager.position.x, villager.position.z)] ?? -1;
    if (height >= 0) villager.position = { ...villager.position, y: height + 1 };
    return 'arrived';
  }

  return 'moving';
}

function applyChoice(
  villager: Villager,
  chosen: { state: AgentState; target?: Vec3; ticks: number },
  tick: number,
  grid: NavGrid,
  _rng: Rng,
  takePathBudget: () => boolean,
): void {
  const target = chosen.target;
  const needsWalk =
    target !== undefined && (target.x !== villager.position.x || target.z !== villager.position.z);

  if (!needsWalk) {
    villager.state = chosen.state;
    villager.busyUntilTick = tick + chosen.ticks;
    return;
  }

  if (!takePathBudget()) {
    // Бюджет путей на тик исчерпан: постоим и попробуем в следующий раз.
    villager.state = 'idle';
    villager.busyUntilTick = tick + 1;
    return;
  }

  const path = isWalkable(grid, target.x, target.z)
    ? findPath(grid, villager.position, target)
    : null;

  if (path === null || path.length < 2) {
    villager.state = 'idle';
    villager.busyUntilTick = tick + 2;
    return;
  }

  villager.state = 'walk';
  villager.target = target;
  villager.path = path;
  villager.pathIndex = 0;
  // Пока идёт — занят дорогой; чем заняться по приходу, решится на месте.
  villager.busyUntilTick = tick + Math.ceil(path.length / CELLS_PER_TICK) + chosen.ticks;
}

/** Действие закрывает свою нужду, пока длится. */
function restoreNeed(villager: Villager): void {
  const need = NEED_OF_ACTION[villager.state];
  const rate = RESTORE_PER_TICK[villager.state];
  if (need === undefined || rate === undefined) return;
  villager.needs[need] = clamp(villager.needs[need] + rate, 0, 100);
}
