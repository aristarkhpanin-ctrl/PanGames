import { buildingType, JOB_TRAIT, LEVEL_MULTIPLIER, type BuildingType } from '../content/buildings';
import { TRAIT_WORK_BONUS } from '../content/traits';
import { clamp } from '../math';
import type { PausedReason, ResourceId, Villager } from '../types';
import { timeOfDayFactor } from './time';
import { workerEfficiency, WORKER_EFFICIENCY_FLOOR } from './needs';
import type { ResourceNode } from '../worldgen/scatter';

/**
 * Производство, склад и работы (§4 ТЗ).
 *
 * Здесь второй жёсткий порог устава: `worker_efficiency` не опускается ниже 0.5.
 * Грустный житель работает медленнее, но остров не сваливается в спираль, из которой
 * игрок уже не выберется.
 */

export const ALL_RESOURCES: readonly ResourceId[] = [
  'wood',
  'stone',
  'clay',
  'sand',
  'fiber',
  'fish',
  'fruit',
  'grain',
  'wool',
  'plank',
  'brick',
  'glass',
  'cloth',
  'bread',
  'tool',
  'meal',
  'shell',
  'inspiration',
];

/** Стартовый лимит склада на каждый ресурс (§4 ТЗ). */
export const BASE_STORAGE_CAP = 200;

/** С чем четверо сходят на берег: на первый шалаш и на первый день. */
export function startingResources(): Record<ResourceId, number> {
  const resources = Object.fromEntries(ALL_RESOURCES.map((id) => [id, 0])) as Record<
    ResourceId,
    number
  >;
  resources.wood = 12;
  resources.fruit = 8;
  resources.fish = 4;
  return resources;
}

export interface PlacedBuilding {
  id: string;
  typeId: string;
  /** Угол участка: остальное считается по footprint и повороту. */
  x: number;
  y: number;
  z: number;
  rotation: 0 | 1 | 2 | 3;
  level: 1 | 2 | 3;
  workers: string[];
  /** Кто здесь ночует. Мест не больше, чем кроватей в каталоге. */
  residents: string[];
  /** 0..1. Единица — здание достроено. */
  progress: number;
  /** Тик, на котором здание достроили. Нужен для правила возврата при сносе. */
  builtAtTick?: number;
  pausedReason?: PausedReason;
}

/** Занимаемая площадь с учётом поворота. */
export function footprintOf(type: BuildingType, rotation: 0 | 1 | 2 | 3): { w: number; d: number } {
  return rotation % 2 === 0
    ? { w: type.footprint.w, d: type.footprint.d }
    : { w: type.footprint.d, d: type.footprint.w };
}

export function storageCap(buildings: readonly PlacedBuilding[]): number {
  let cap = BASE_STORAGE_CAP;
  for (const building of buildings) {
    if (building.progress < 1) continue;
    cap += buildingType(building.typeId)?.storage ?? 0;
  }
  return cap;
}

/** Сколько всего мест для сна на острове. */
export function totalBeds(buildings: readonly PlacedBuilding[]): number {
  let beds = 0;
  for (const building of buildings) {
    if (building.progress < 1) continue;
    beds += buildingType(building.typeId)?.beds ?? 0;
  }
  return beds;
}

/**
 * Ближайшая непустая залежь нужного вида.
 *
 * Выработанная залежь не останавливает работу: карьер просто начинает возить издалека
 * и работает медленнее. Встать он может, только когда камня не осталось нигде.
 */
export function nearestNode(
  building: { x: number; z: number },
  kind: ResourceNode['kind'],
  nodes: readonly ResourceNode[],
): ResourceNode | null {
  let best: ResourceNode | null = null;
  let bestDistance = Infinity;

  for (const node of nodes) {
    if (node.kind !== kind || node.amount <= 0) continue;
    const distance = Math.hypot(node.x - building.x, node.z - building.z);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = node;
  }

  return best;
}

/**
 * Близость к источнику (§4 ТЗ): 0.7…1.0.
 * Далеко от рощи лесопилка работает медленнее, но не останавливается.
 */
export function resourceProximity(
  building: PlacedBuilding,
  type: BuildingType,
  nodes: readonly ResourceNode[],
): number {
  const kind = nodeKindFor(type);
  if (kind === null) return 1;

  const node = nearestNode(building, kind, nodes);
  if (node === null) return 0.7;

  const distance = Math.hypot(node.x - building.x, node.z - building.z);
  // До двадцати клеток — без потерь, дальше плавно вниз до 0.7.
  return clamp(1 - Math.max(0, distance - 20) / 120, 0.7, 1);
}

export function nodeKindFor(type: BuildingType): ResourceNode['kind'] | null {
  switch (type.jobType) {
    case 'wood':
      return 'wood';
    case 'stone':
      return 'stone';
    case 'clay':
      return 'clay';
    case 'sand':
      return 'sand';
    case 'fish':
      return 'fish';
    case 'forage':
      return 'berry';
    default:
      return null;
  }
}

export interface ProductionResult {
  gained: Partial<Record<ResourceId, number>>;
  consumed: Partial<Record<ResourceId, number>>;
  paused?: PausedReason;
}

/**
 * Выработка здания за тик по формуле §4 ТЗ:
 * `base × worker_efficiency × building_level × resource_proximity × time_of_day`.
 *
 * Переполнение склада не теряет ничего: производство просто встаёт с тихой пометкой.
 */
export function produce(
  building: PlacedBuilding,
  workers: readonly Villager[],
  resources: Readonly<Record<ResourceId, number>>,
  cap: number,
  hour: number,
  nodes: readonly ResourceNode[],
): ProductionResult {
  const type = buildingType(building.typeId);
  const empty: ProductionResult = { gained: {}, consumed: {} };

  if (type === undefined || building.progress < 1) return empty;
  if (type.output === undefined && type.input === undefined) return empty;
  if (type.workers > 0 && workers.length === 0) return { ...empty, paused: 'no_worker' };

  // Залежь выработана вся до последней — здание тихо останавливается, а переезд бесплатен.
  const kind = nodeKindFor(type);
  if (kind !== null && nearestNode(building, kind, nodes) === null) {
    return { ...empty, paused: 'no_source' };
  }

  const efficiency = crewEfficiency(workers, type);
  const rate =
    efficiency *
    LEVEL_MULTIPLIER[building.level] *
    resourceProximity(building, type, nodes) *
    timeOfDayFactor(hour);

  // Ночью работают только совы; для остальных множитель времени суток уже всё сказал.
  if (rate <= 0) return empty;

  const consumed: Partial<Record<ResourceId, number>> = {};
  if (type.input !== undefined) {
    for (const [id, amount] of Object.entries(type.input) as [ResourceId, number][]) {
      const need = amount * rate;
      if (resources[id] < need) return { ...empty, paused: 'no_input' };
      consumed[id] = need;
    }
  }

  const gained: Partial<Record<ResourceId, number>> = {};
  if (type.output !== undefined) {
    for (const [id, amount] of Object.entries(type.output) as [ResourceId, number][]) {
      if (resources[id] >= cap) return { ...empty, paused: 'storage_full' };
      gained[id] = amount * rate;
    }
  }

  return { gained, consumed };
}

/** Совокупная эффективность смены. Никогда не ниже пола устава. */
export function crewEfficiency(workers: readonly Villager[], type: BuildingType): number {
  if (workers.length === 0) return 0;

  let sum = 0;
  for (const worker of workers) {
    const wanted = type.jobType === undefined ? null : JOB_TRAIT[type.jobType];
    const bonus = wanted !== null && worker.traits.includes(wanted as never) ? TRAIT_WORK_BONUS : 0;
    sum += workerEfficiency(worker.mood, bonus);
  }

  const average = sum / workers.length;
  // Полная смена работает быстрее одиночки, но не кратно: люди мешают друг другу.
  const crewFactor = 1 + (workers.length - 1) * 0.6;
  return Math.max(average * crewFactor, WORKER_EFFICIENCY_FLOOR);
}

/** Кладёт добытое на склад, обрезая по лимиту. Ничего не теряется молча. */
export function applyProduction(
  resources: Record<ResourceId, number>,
  result: ProductionResult,
  cap: number,
): void {
  for (const [id, amount] of Object.entries(result.consumed) as [ResourceId, number][]) {
    resources[id] = Math.max(0, resources[id] - amount);
  }
  for (const [id, amount] of Object.entries(result.gained) as [ResourceId, number][]) {
    resources[id] = clamp(resources[id] + amount, 0, cap);
  }
}

/** Хватает ли на постройку. */
export function canAfford(
  resources: Readonly<Record<ResourceId, number>>,
  cost: Partial<Record<ResourceId, number>>,
): boolean {
  for (const [id, amount] of Object.entries(cost) as [ResourceId, number][]) {
    if (resources[id] < amount) return false;
  }
  return true;
}

/** Чего именно не хватает — интерфейс объясняет это человеческим языком (§8 ТЗ). */
export function missingResources(
  resources: Readonly<Record<ResourceId, number>>,
  cost: Partial<Record<ResourceId, number>>,
): Partial<Record<ResourceId, number>> {
  const missing: Partial<Record<ResourceId, number>> = {};
  for (const [id, amount] of Object.entries(cost) as [ResourceId, number][]) {
    const short = amount - resources[id];
    if (short > 0) missing[id] = Math.ceil(short);
  }
  return missing;
}

/** Цена улучшения: доля от постройки, растущая с уровнем (§6 ТЗ). */
export function upgradeCost(
  type: BuildingType,
  currentLevel: 1 | 2 | 3,
): Partial<Record<ResourceId, number>> {
  const share = currentLevel === 1 ? 0.6 : 0.9;
  const cost: Partial<Record<ResourceId, number>> = {};
  for (const [id, amount] of Object.entries(type.cost) as [ResourceId, number][]) {
    cost[id] = Math.ceil(amount * share);
  }
  return cost;
}

/**
 * Возврат при сносе (устав, п. 6): первые десять минут — сто процентов, потом семьдесят.
 * Отмена недостроенного заказа возвращает всё всегда.
 */
export const FULL_REFUND_TICKS = 60;

/** Сколько свободных кроватей осталось в доме. Недостроенный дом не считается. */
export function freeBeds(building: PlacedBuilding): number {
  if (building.progress < 1) return 0;
  const beds = buildingType(building.typeId)?.beds ?? 0;
  return Math.max(0, beds - building.residents.length);
}

/** Сколько свободных мест на работе. */
export function freeWorkPlaces(building: PlacedBuilding): number {
  if (building.progress < 1) return 0;
  const places = buildingType(building.typeId)?.workers ?? 0;
  return Math.max(0, places - building.workers.length);
}

/** Дом жителя. Живёт в зданиях, а не в самом жителе: мир меняется только командами. */
export function homeOf(
  buildings: readonly PlacedBuilding[],
  villagerId: string,
): PlacedBuilding | undefined {
  return buildings.find((building) => building.residents.includes(villagerId));
}

export function jobOf(
  buildings: readonly PlacedBuilding[],
  villagerId: string,
): PlacedBuilding | undefined {
  return buildings.find((building) => building.workers.includes(villagerId));
}

/**
 * Уют места (§4 ТЗ) — не ресурс, а функция от мира: складывается из того, что стоит и растёт
 * вокруг. Считается по радиусу каждого здания и падает с расстоянием.
 *
 * Уют ничего не отнимает и никогда не бывает отрицательным: худшее, что может случиться, —
 * пустое место без прибавки.
 */
export function comfortAt(
  pos: { x: number; z: number },
  buildings: readonly PlacedBuilding[],
  plants: readonly { x: number; z: number }[],
): number {
  let comfort = 0;

  for (const building of buildings) {
    if (building.progress < 1) continue;
    const type = buildingType(building.typeId);
    if (type === undefined || type.comfortValue === 0) continue;

    const distance = Math.hypot(building.x - pos.x, building.z - pos.z);
    if (distance > type.comfortRadius) continue;
    comfort += type.comfortValue * (1 - distance / Math.max(1, type.comfortRadius));
  }

  // Зелень рядом тоже считается: клумба под окном — это и есть уют (§7 ТЗ).
  for (const plant of plants) {
    const distance = Math.hypot(plant.x - pos.x, plant.z - pos.z);
    if (distance <= PLANT_COMFORT_RADIUS) comfort += 0.5 * (1 - distance / PLANT_COMFORT_RADIUS);
  }

  return comfort;
}

/** Насколько далеко от растения ещё приятно. */
const PLANT_COMFORT_RADIUS = 6;

/** Уют, при котором прибавка к красоте максимальна. Выше — просто хорошо. */
export const COMFORT_FULL = 18;

export function refundOf(
  building: PlacedBuilding,
  cost: Partial<Record<ResourceId, number>>,
  tick: number,
): Partial<Record<ResourceId, number>> {
  const built = building.builtAtTick;
  const full = building.progress < 1 || built === undefined || tick - built <= FULL_REFUND_TICKS;
  const share = full ? 1 : 0.7;

  const refund: Partial<Record<ResourceId, number>> = {};
  for (const [id, amount] of Object.entries(cost) as [ResourceId, number][]) {
    refund[id] = Math.floor(amount * share);
  }
  return refund;
}
