import { buildingType } from '../content/buildings';
import type { Villager } from '../types';
import type { PlacedBuilding } from './economy';
import { BOND_LEVELS } from './social';
import { TICKS_PER_DAY } from './time';
import { createStartingVillagers } from './villager';

/**
 * Дети и семьи (§5 ТЗ). Механика **необязательная** и по умолчанию выключена.
 *
 * ## Что здесь можно и чего нельзя
 *
 * Ребёнок — это подарок, а не показатель. Его нельзя запланировать, поторопить или потерять.
 * Появляется он сам и только там, где двоим близким людям хорошо вместе и есть куда положить
 * третьего. Не появился — не случилось ровным счётом ничего: ни строки упрёка, ни счётчика,
 * ни «условия не выполнены».
 *
 * Ребёнок не работает и не может быть назначен на работу. Он прибавляет уюта вокруг —
 * этим его вклад и исчерпывается. Через семь игровых дней он просто становится взрослым,
 * и с этого момента ничем не отличается от остальных.
 *
 * Чего здесь нет и не будет: смертности, болезней, ухода за ребёнком как обязанности,
 * счётчика рождений, требований «заведите ещё», очереди и таймера до следующего.
 */

/** Последняя ступень близости: «близкие». Приведение безопасно: уровней ровно четыре. */
const CLOSEST_LEVEL = (BOND_LEVELS.length - 1) as 0 | 1 | 2 | 3;

/** Через сколько игровых дней ребёнок становится взрослым (§5 ТЗ). */
export const CHILD_DAYS = 7;

/** Сколько уюта ребёнок прибавляет рядом с собой и на каком расстоянии. */
export const CHILD_COMFORT = 1.5;
export const CHILD_COMFORT_RADIUS = 8;

/** Реже чем раз в игровой день ничего не происходит: остров не роддом. */
export const BIRTH_EVERY_TICKS = TICKS_PER_DAY;

/** Насколько уютно должно быть вокруг дома. Порог мягкий: это не экзамен. */
export const COMFORT_FOR_FAMILY = 6;

/** Настройки острова, которые игрок задаёт сам. Семьи выключены по умолчанию. */
export interface IslandSettings {
  families: boolean;
}

export const DEFAULT_SETTINGS: IslandSettings = { families: false };

/** Ребёнок ли житель сейчас. Взрослые, приплывшие на остров, детьми не бывают никогда. */
export function isChild(villager: Villager, tick: number): boolean {
  const born = villager.bornAtTick;
  if (born === undefined) return false;
  return tick - born < CHILD_DAYS * TICKS_PER_DAY;
}

/** Сколько ребёнку осталось до взросления в игровых днях. Для взрослых — 0. */
export function daysToGrowUp(villager: Villager, tick: number): number {
  const born = villager.bornAtTick;
  if (born === undefined) return 0;
  const left = (born + CHILD_DAYS * TICKS_PER_DAY - tick) / TICKS_PER_DAY;
  return Math.max(0, left);
}

/** Повзрослел ли ребёнок ровно на этом тике: по этому событию пишется запись в дневник. */
export function grewUpThisTick(villager: Villager, tick: number): boolean {
  const born = villager.bornAtTick;
  if (born === undefined) return false;
  return tick - born === CHILD_DAYS * TICKS_PER_DAY;
}

/** Дом, где может появиться ребёнок, и двое, кому он будет рад. */
export interface Expecting {
  home: PlacedBuilding;
  parents: [Villager, Villager];
}

/**
 * Где на острове может появиться ребёнок.
 *
 * Условия читаются как описание хорошей жизни, а не как список требований: двое близких
 * живут в одном доме, в доме есть свободная кровать, вокруг уютно. Ни одно из них
 * не подгоняется игроком напрямую — они получаются сами, если на острове хорошо.
 */
export function expectingHome(
  villagers: readonly Villager[],
  buildings: readonly PlacedBuilding[],
  comfortAt: (pos: { x: number; z: number }) => number,
): Expecting | null {
  const byId = new Map(villagers.map((villager) => [villager.id, villager]));

  for (const home of buildings) {
    if (home.progress < 1) continue;

    const type = buildingType(home.typeId);
    const beds = type?.beds ?? 0;
    // Шалаш и домик на двоих не годятся: третьему там негде спать.
    if (beds < 3) continue;
    if (home.residents.length < 2) continue;
    // Нужна свободная кровать: ребёнку тоже где-то ночевать.
    if (home.residents.length >= beds) continue;
    if (comfortAt({ x: home.x, z: home.z }) < COMFORT_FOR_FAMILY) continue;

    const pair = closestPair(home.residents, byId);
    if (pair !== null) return { home, parents: pair };
  }

  return null;
}

/** Двое жильцов, чья связь дошла до последней ступени — «близкие». */
function closestPair(
  residents: readonly string[],
  byId: ReadonlyMap<string, Villager>,
): [Villager, Villager] | null {
  for (const id of residents) {
    const villager = byId.get(id);
    if (villager === undefined) continue;

    for (const bond of villager.bonds) {
      if (bond.level < CLOSEST_LEVEL) continue;
      if (!residents.includes(bond.withId)) continue;

      const other = byId.get(bond.withId);
      if (other !== undefined) return [villager, other];
    }
  }

  return null;
}

/**
 * Уют от детей рядом.
 *
 * Считается отдельно от зданий и растений по одной причине: ребёнок ходит. Уют от него —
 * это не свойство места, а то, что он приносит с собой туда, где сейчас есть.
 */
export function childComfortAt(
  pos: { x: number; z: number },
  villagers: readonly Villager[],
  tick: number,
): number {
  let comfort = 0;

  for (const villager of villagers) {
    if (!isChild(villager, tick)) continue;

    const distance = Math.hypot(villager.position.x - pos.x, villager.position.z - pos.z);
    if (distance > CHILD_COMFORT_RADIUS) continue;
    comfort += CHILD_COMFORT * (1 - distance / CHILD_COMFORT_RADIUS);
  }

  return comfort;
}

/**
 * Малыш. Делается тем же кодом, что и все остальные жители: имя, черты и внешность
 * выводятся из сида, и ничего «детского» в них нет — он просто пока небольшой.
 *
 * Функция здесь, а не на сервере, ровно затем, чтобы её можно было проверить тестом:
 * серверу остаётся положить готового человека в список.
 */
export function newborn(
  seed: number,
  islandId: string,
  id: string,
  expecting: Expecting,
  tick: number,
): Villager | null {
  const [base] = createStartingVillagers(seed, islandId, [
    { x: expecting.home.x, y: expecting.home.y, z: expecting.home.z },
  ]);
  if (base === undefined) return null;

  return {
    ...base,
    id,
    arrivedAtTick: tick,
    bornAtTick: tick,
    parents: [expecting.parents[0].id, expecting.parents[1].id],
    // Связи начинаются с нуля: близость к родителям он наживёт сам, как и все.
    bonds: [],
  };
}

/** Работать ребёнку нельзя — и это проверяется здесь, а не спрятанной кнопкой. */
export function canWork(villager: Villager, tick: number): boolean {
  return !isChild(villager, tick);
}
