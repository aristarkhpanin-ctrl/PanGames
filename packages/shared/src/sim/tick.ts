import { clamp } from '../math';
import type { AgentState, Vec3, Villager } from '../types';
import { columnIndex } from '../voxels';
import { createRng, deriveSeed, type Rng } from '../worldgen/rng';
import { chooseAction, NEED_OF_ACTION, RESTORE_PER_TICK, type AgentContext } from './agents';
import { comfortAt, COMFORT_FULL, homeOf, jobOf, type PlacedBuilding } from './economy';
import { findPath, isWalkable, type NavGrid } from './navigation';
import { chooseFavoriteSpot, growBonds } from './social';
import {
  activeWishes,
  wishFor,
  wishFulfilled,
  WISHES_PER_ISLAND,
  type WishContext,
} from './wishes';
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

export type SimEventKind =
  | 'arrived'
  | 'action_started'
  | 'path_failed'
  | 'friendship'
  | 'favorite_spot'
  | 'wish'
  | 'wish_done';

export interface SimEvent {
  kind: SimEventKind;
  villagerId: string;
  state?: AgentState;
  /** Второй участник: с кем подружились. */
  withId?: string;
  /** Где: любимое место. */
  where?: Vec3;
}

export interface TickInput {
  grid: NavGrid;
  /** Красивые места: берег, диковинка. Туда ходят любоваться. */
  scenicSpots: readonly Vec3[];
  /** Сид острова — из него выводится случайность тика. */
  seed: number;
  /** Здания острова. Дом и работа хранятся в них, а не в жителе. */
  buildings?: readonly PlacedBuilding[];
  /** Праздник: до какого тика все идут к общему огню (§7 ТЗ). */
  festivalUntilTick?: number;
  /** Что растёт на острове: зелень поблизости прибавляет уюта. */
  plants?: readonly { x: number; z: number }[];
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

  const buildings = input.buildings ?? [];
  const plants = input.plants ?? [];

  const context: AgentContext = {
    grid: input.grid,
    hour,
    tick,
    villagers: state.villagers,
    scenicSpots: input.scenicSpots,
    buildings,
  };

  const celebrating = (input.festivalUntilTick ?? 0) > tick;
  let pathsLeft = PATH_BUDGET_PER_TICK;
  const villagers = state.villagers.map((villager) => {
    const next = { ...villager, needs: decayNeeds(villager.needs, GAME_MINUTES_PER_TICK / 60) };

    // Дом и работа живут в зданиях: мир меняется командами, а житель их только отражает.
    const home = homeOf(buildings, next.id);
    const job = jobOf(buildings, next.id);
    if (home === undefined) delete next.homeId;
    else next.homeId = home.id;
    if (job === undefined) delete next.jobId;
    else next.jobId = job.id;

    // Укрытие бинарно: есть своя крыша или нет.
    next.needs.shelter = home === undefined ? 0 : 100;

    const moved = advance(next, input.grid);
    if (moved === 'arrived') events.push({ kind: 'arrived', villagerId: next.id });

    const busy = (next.busyUntilTick ?? 0) > tick;
    const walking = next.state === 'walk' && next.target !== undefined;

    // Праздник сильнее любых нужд: сегодня никто не работает (§7 ТЗ).
    if (celebrating && !walking) {
      next.state = 'celebrate';
      next.needs.social = clamp(next.needs.social + 14, 0, 100);
      next.needs.beauty = clamp(next.needs.beauty + 8, 0, 100);
      restoreFromComfort(next, buildings, plants);
      next.mood = clamp(
        smoothMood(next.mood, next.needs, GAME_MINUTES_PER_TICK / 60),
        MOOD_FLOOR,
        100,
      );
      return next;
    }

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
    restoreFromComfort(next, buildings, plants);
    next.mood = smoothMood(next.mood, next.needs, GAME_MINUTES_PER_TICK / 60);
    // Пол настроения — устав, а не баланс. Проверяем ещё раз после всех расчётов.
    next.mood = clamp(next.mood, MOOD_FLOOR, 100);

    return next;
  });

  // Отношения, любимые места и желания — то, ради чего игра открывается (§5, §7 ТЗ).
  for (const risen of growBonds(villagers)) {
    if (risen.level < 2) continue;
    events.push({ kind: 'friendship', villagerId: risen.a.id, withId: risen.b.id });
  }

  for (const villager of villagers) {
    const spot = chooseFavoriteSpot(villager, input.grid, input.scenicSpots, tick);
    if (spot === null) continue;

    villager.favoriteSpot = spot;
    events.push({ kind: 'favorite_spot', villagerId: villager.id, where: spot });
  }

  const wishContext: WishContext = { villagers, buildings, plants: input.plants ?? [], tick };

  for (const villager of villagers) {
    if (villager.wish !== undefined) {
      // Сбылось — тихая радость и запись в дневник. Не сбылось — не происходит ничего:
      // ни напоминания, ни счётчика, ни значка (§7 ТЗ).
      if (!wishFulfilled(villager, wishContext)) continue;
      delete villager.wish;
      events.push({ kind: 'wish_done', villagerId: villager.id });
      continue;
    }

    // Желания появляются редко и по одному: очередь просьб — это уже список задач.
    if (activeWishes(villagers) >= WISHES_PER_ISLAND) continue;
    if (rng.range(0, 1) > WISH_CHANCE_PER_TICK) continue;

    const wish = wishFor(villager, wishContext);
    if (wish === null) continue;

    villager.wish = wish;
    events.push({ kind: 'wish', villagerId: villager.id });
  }

  return { state: { tick, villagers }, events };
}

/** Насколько вероятно, что желание родится именно в этот тик. Редко — и в этом суть. */
const WISH_CHANCE_PER_TICK = 0.01;

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

/** Сколько красоты прибавляет за тик место с полным уютом. */
const COMFORT_BEAUTY_PER_TICK = 3;

/**
 * Уют места сам по себе делает жизнь красивее (§4 ТЗ): житель на обустроенной улице
 * теряет «красоту» медленнее, чем на пустом склоне. Ничего не отнимает — только прибавляет.
 */
function restoreFromComfort(
  villager: Villager,
  buildings: readonly PlacedBuilding[],
  plants: readonly { x: number; z: number }[],
): void {
  if (buildings.length === 0 && plants.length === 0) return;

  const comfort = comfortAt(villager.position, buildings, plants);
  if (comfort <= 0) return;

  const share = Math.min(1, comfort / COMFORT_FULL);
  villager.needs.beauty = clamp(villager.needs.beauty + COMFORT_BEAUTY_PER_TICK * share, 0, 100);
}
