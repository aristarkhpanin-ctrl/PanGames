import { buildingType } from '../content/buildings';
import { clamp } from '../math';
import type { ResourceId, Villager } from '../types';
import type { ResourceNode } from '../worldgen/scatter';
import { autoAssignments } from './assign';
import { applyCommand } from './apply';
import { nearestNode, nodeKindFor, produce, storageCap, type PlacedBuilding } from './economy';
import { MOOD_OFFLINE_FLOOR, NEED_KEYS } from './needs';
import { hourOfTick, REAL_SECONDS_PER_GAME_HOUR, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import { validate } from './validate';
import { commitEffect, type WorldReader, type WorldState } from './world';

/**
 * Сводная симуляция: что было с островом, пока игрока не было (§3 ТЗ).
 *
 * Это вторая, отдельная модель — и путать её с живой нельзя. Живая ведёт каждого жителя
 * по одному, с путём и решениями, и работает только пока игрок онлайн. Сводная не трогает
 * агентов вовсе: она берёт состав жителей, зданий и назначений и считает результат формулами.
 *
 * Разница не в аккуратности, а в порядке величин. Сутки отсутствия — это 8640 живых тиков
 * на каждый остров при входе, и на входе всех игроков сразу сервер бы просто лёг.
 *
 * Функция чистая: состояние на входе не меняется, время и случайность приходят аргументами.
 */

/** Сколько игровых часов в одном реальном (§3 ТЗ). */
export const GAME_HOURS_PER_REAL_HOUR = 3600 / REAL_SECONDS_PER_GAME_HOUR;

/** Первые часы отсутствия остров живёт в полную силу. */
export const FULL_SPEED_HOURS = 12;

/** Дальше — вполсилы с небольшим: остров не должен обгонять того, кто в него играет. */
export const SLOW_FACTOR = 0.6;

/** Потолок накопления. Дальше остров дремлет: ничего не растёт, но и не портится. */
export const CAP_HOURS = 48;

/**
 * Куда сходится настроение в отсутствие игрока: «спокоен».
 * Ни выше, ни ниже — пока тебя нет, драмы не происходит (§3 ТЗ).
 */
export const OFFLINE_MOOD = 65;

/** За сколько игровых часов настроение доходит до спокойного. */
const MOOD_SETTLE_HOURS = 8;

/**
 * Насколько быстро идёт стройка в отсутствие игрока.
 *
 * Живая симуляция считает помощников по тем, кто оказался рядом; в сводной никто нигде
 * не стоит, и гадать о расстояниях бессмысленно. Берётся скорость одной спокойной смены —
 * этого хватает, чтобы стройка закончилась, а закончиться она обязана (§3 ТЗ).
 */
const OFFLINE_BUILD_SPEED = 1.5;

/** Что случилось за время отсутствия. Данные, а не текст: слова подберёт интерфейс (§8 ТЗ). */
export type CatchUpEvent =
  | { kind: 'built'; buildingId: string; typeId: string }
  | { kind: 'settled'; villagerId: string; buildingId: string }
  | { kind: 'hired'; villagerId: string; buildingId: string }
  | { kind: 'gathered'; resource: ResourceId; amount: number }
  | { kind: 'storage_full'; resource: ResourceId }
  | { kind: 'dozed'; hours: number };

export interface AggregateInput {
  world: WorldState;
  villagers: readonly Villager[];
  nodes: readonly ResourceNode[];
  reader: WorldReader;
  /** Тик, на котором остров остановился. */
  fromTick: number;
  /** Сколько реального времени прошло, в миллисекундах. Считает только сервер (§9 ТЗ). */
  absenceMs: number;
}

export interface AggregateResult {
  world: WorldState;
  villagers: Villager[];
  tick: number;
  events: CatchUpEvent[];
  /** Сколько игровых часов зачлось. Ноль — заходили только что, догона не было. */
  gameHours: number;
}

/**
 * Сколько игровых часов зачесть за отсутствие (§3 ТЗ).
 *
 * Первые двенадцать реальных часов — полная скорость, дальше коэффициент, после сорока
 * восьми не начисляется ничего. Потолок здесь не ради баланса, а ради того же устава:
 * вернувшийся через неделю не должен чувствовать, что неделю назад надо было зайти.
 */
export function creditedGameHours(absenceMs: number): number {
  const realHours = Math.max(0, absenceMs) / 3_600_000;

  const full = Math.min(realHours, FULL_SPEED_HOURS);
  const slow = Math.max(0, Math.min(realHours, CAP_HOURS) - FULL_SPEED_HOURS) * SLOW_FACTOR;

  return (full + slow) * GAME_HOURS_PER_REAL_HOUR;
}

export function catchUp(input: AggregateInput): AggregateResult {
  const gameHours = Math.floor(creditedGameHours(input.absenceMs));
  const world = cloneWorld(input.world);
  const villagers = input.villagers.map(calmCopy);
  const events: CatchUpEvent[] = [];

  if (gameHours <= 0) {
    return { world, villagers, tick: input.fromTick, events, gameHours: 0 };
  }

  // Залежи считаются по копиям: входные данные генератора остаются нетронутыми.
  const nodes = input.nodes.map((node) => ({
    ...node,
    amount: world.nodes.get(node.id) ?? node.amount,
  }));

  const gained: Partial<Record<ResourceId, number>> = {};
  const full = new Set<ResourceId>();
  let tick = input.fromTick;

  for (let hour = 0; hour < gameHours; hour += 1) {
    settle(villagers, 1);

    const changed = stepHour(world, villagers, nodes, tick, gained, full, events);
    tick += TICKS_PER_HOUR;

    // Всё построено, склад полон, добывать больше некуда — дальше ничего не изменится.
    // Без этого догон на двести часов считался бы столько же, сколько догон на сорок восемь.
    if (!changed) {
      const left = gameHours - hour - 1;
      if (left > 0) {
        // Мир замер, а люди — нет: оставшееся время настроение доходит до спокойного сразу.
        settle(villagers, left);
        tick += left * TICKS_PER_HOUR;
      }
      break;
    }
  }

  // Остров дремал: отсутствие было дольше потолка, и часть времени не зачлась (§3 ТЗ).
  const realHours = input.absenceMs / 3_600_000;
  if (realHours > CAP_HOURS) {
    events.push({ kind: 'dozed', hours: Math.floor(realHours - CAP_HOURS) });
  }

  for (const [id, amount] of Object.entries(gained) as [ResourceId, number][]) {
    if (amount >= 1) events.push({ kind: 'gathered', resource: id, amount: Math.floor(amount) });
  }
  for (const id of full) events.push({ kind: 'storage_full', resource: id });

  for (const node of nodes) {
    if (node.amount !== input.nodes.find((source) => source.id === node.id)?.amount) {
      world.nodes.set(node.id, node.amount);
    }
  }

  return { world, villagers, tick, events, gameHours };
}

/**
 * Один игровой час: стройка, производство, отрастание залежей и новые назначения.
 * Возвращает `false`, если за час в мире ничего не изменилось.
 */
function stepHour(
  world: WorldState,
  villagers: Villager[],
  nodes: (ResourceNode & { amount: number })[],
  tick: number,
  gained: Partial<Record<ResourceId, number>>,
  full: Set<ResourceId>,
  events: CatchUpEvent[],
): boolean {
  let changed = false;
  const hour = hourOfTick(tick);
  const cap = storageCap(world.buildings);

  // Стройка идёт и заканчивается: незавершённых заказов после отсутствия не остаётся (§3 ТЗ).
  for (const [index, building] of world.buildings.entries()) {
    if (building.progress >= 1) continue;

    const type = buildingType(building.typeId);
    if (type === undefined) continue;

    const step = (OFFLINE_BUILD_SPEED * TICKS_PER_HOUR) / Math.max(1, type.buildTicks);
    const progress = Math.min(1, building.progress + step);
    const after: PlacedBuilding = { ...building, progress };
    if (progress >= 1) {
      after.builtAtTick = tick;
      events.push({ kind: 'built', buildingId: building.id, typeId: building.typeId });
    }

    world.buildings[index] = after;
    changed = true;
  }

  // Производство: та же формула §4, что и в живой симуляции, только сразу за час.
  const running: Record<ResourceId, number> = { ...world.resources };
  for (const building of world.buildings) {
    if (building.progress < 1) continue;

    const type = buildingType(building.typeId);
    if (type === undefined) continue;

    const crew = villagers.filter((villager) => building.workers.includes(villager.id));
    const result = produce(building, crew, running, cap, hour, nodes);

    if (result.paused === 'storage_full') {
      for (const id of Object.keys(type.output ?? {}) as ResourceId[]) full.add(id);
      continue;
    }

    let taken = 0;
    for (const [id, amount] of Object.entries(result.gained) as [ResourceId, number][]) {
      const perHour = amount * TICKS_PER_HOUR;
      const room = Math.max(0, cap - running[id]);
      const actual = Math.min(perHour, room);
      if (actual <= 0) {
        full.add(id);
        continue;
      }
      running[id] += actual;
      gained[id] = (gained[id] ?? 0) + actual;
      taken += actual;
      changed = true;
    }

    for (const [id, amount] of Object.entries(result.consumed) as [ResourceId, number][]) {
      const perHour = amount * TICKS_PER_HOUR;
      running[id] = Math.max(0, running[id] - perHour);
      changed = true;
    }

    // Добытое берётся из земли, а не из воздуха — как и в живой симуляции.
    const kind = nodeKindFor(type);
    if (kind !== null && taken > 0) {
      const node = nearestNode(building, kind, nodes);
      if (node !== null) node.amount = Math.max(0, node.amount - taken);
    }
  }

  world.resources = running;

  // Отрастание залежей по тем же правилам, что и в живой симуляции (§4 ТЗ).
  for (const node of nodes) {
    if (node.regenPerDay <= 0) continue;
    const before = node.amount;
    node.amount = Math.min(
      node.capacity,
      node.amount + (node.regenPerDay / TICKS_PER_DAY) * TICKS_PER_HOUR,
    );
    if (node.amount !== before) changed = true;
  }

  // Достроенный дом кто-то занимает, на новую работу кто-то выходит.
  for (const command of autoAssignments(world, villagers)) {
    const reader = emptyReader;
    if (!validate(command, world, reader).ok) continue;

    commitEffect(world, applyCommand(command, world, reader, tick));
    changed = true;

    if (command.t === 'assign_home') {
      events.push({
        kind: 'settled',
        villagerId: command.villagerId,
        buildingId: command.buildingId,
      });
    } else if (command.t === 'assign_job' && command.buildingId !== null) {
      events.push({
        kind: 'hired',
        villagerId: command.villagerId,
        buildingId: command.buildingId,
      });
    }
  }

  return changed;
}

/**
 * Настроение сходится к спокойному и не опускается ниже пола устава.
 *
 * Нужды подтягиваются туда же: житель, которого никто не трогал сутки, не голодает —
 * он просто жил своей жизнью. Схождение за много часов считается формулой, а не циклом:
 * когда мир замер, крутить его дальше незачем, а люди всё равно должны успокоиться.
 */
function settle(villagers: Villager[], hours: number): void {
  const remaining = Math.pow(1 - 1 / MOOD_SETTLE_HOURS, hours);

  for (const villager of villagers) {
    villager.mood = clamp(toCalm(villager.mood, remaining), MOOD_OFFLINE_FLOOR, 100);

    for (const key of NEED_KEYS) {
      // Укрытие бинарно и подтягиванию не подлежит: крыша либо есть, либо нет.
      if (key === 'shelter') continue;
      villager.needs[key] = clamp(toCalm(villager.needs[key], remaining), 0, 100);
    }
  }
}

function toCalm(value: number, remaining: number): number {
  return OFFLINE_MOOD + (value - OFFLINE_MOOD) * remaining;
}

/** Копия жителя без пути: вернувшись, он начинает с чистого решения, а не с полдороги. */
function calmCopy(villager: Villager): Villager {
  const copy: Villager = {
    ...villager,
    needs: { ...villager.needs },
    bonds: villager.bonds.map((bond) => ({ ...bond })),
    state: 'idle',
  };
  delete copy.path;
  delete copy.pathIndex;
  delete copy.target;
  delete copy.busyUntilTick;
  return copy;
}

function cloneWorld(world: WorldState): WorldState {
  return {
    ...world,
    edits: new Map(world.edits),
    plants: world.plants.map((plant) => ({ ...plant })),
    buildings: world.buildings.map((building) => ({
      ...building,
      workers: [...building.workers],
      residents: [...building.residents],
    })),
    resources: { ...world.resources },
    nodes: new Map(world.nodes),
  };
}

/**
 * Назначения не смотрят на воксели, но `validate` принимает мир целиком.
 * Читать здесь нечего, и подсовывать сюда настоящий остров незачем.
 */
const emptyReader: WorldReader = { material: () => 0 };
