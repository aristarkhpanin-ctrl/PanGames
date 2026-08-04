import { buildingType } from '../content/buildings';
import type { ResourceId, Villager } from '../types';
import type { ResourceNode } from '../worldgen/scatter';
import {
  applyProduction,
  nearestNode,
  nodeKindFor,
  produce,
  storageCap,
  type PlacedBuilding,
} from './economy';
import { TICKS_PER_DAY } from './time';
import type { BuildingChange, CommandEffect, NodeChange, WorldState } from './world';

/**
 * Хозяйственный тик: стройка, производство и залежи (§4, §6 ТЗ).
 *
 * Отдельно от тика жителей, потому что считает другое: там решения людей, здесь — что
 * произвели здания. Функция чистая и возвращает такой же результат, как команда, поэтому
 * применяется тем же кодом и так же разворачивается назад.
 */

export interface EconomyInput {
  villagers: readonly Villager[];
  hour: number;
  tick: number;
  /** Залежи, какими их выдал генератор. Текущий остаток берётся из состояния мира. */
  nodes: readonly ResourceNode[];
}

/** Насколько быстрее идёт стройка от каждого жителя поблизости. */
const HELPER_SPEED = 0.5;

/** Как близко надо быть, чтобы считаться помогающим на стройке. */
const HELP_RADIUS = 8;

export function economyTick(state: WorldState, input: EconomyInput): CommandEffect {
  const changes: BuildingChange[] = [];
  const resources: Partial<Record<ResourceId, number>> = {};

  const cap = storageCap(state.buildings);
  // Склад считается по снимку на начало тика: иначе порядок зданий влиял бы на итог.
  const running: Record<ResourceId, number> = { ...state.resources };

  // Копии залежей: их остаток меняется прямо в тике, но входные данные остаются нетронутыми.
  const live = input.nodes.map((node) => ({
    ...node,
    amount: state.nodes.get(node.id) ?? node.amount,
  }));

  for (const building of state.buildings) {
    const type = buildingType(building.typeId);
    if (type === undefined) continue;

    if (building.progress < 1) {
      changes.push(advanceConstruction(building, type.buildTicks, input));
      continue;
    }

    const workers = input.villagers.filter((villager) => building.workers.includes(villager.id));
    const result = produce(building, workers, running, cap, input.hour, live);

    applyProduction(running, result, cap);

    let taken = 0;
    for (const [id, amount] of Object.entries(result.gained) as [ResourceId, number][]) {
      resources[id] = (resources[id] ?? 0) + amount;
      taken += amount;
    }
    for (const [id, amount] of Object.entries(result.consumed) as [ResourceId, number][]) {
      resources[id] = (resources[id] ?? 0) - amount;
    }

    // Добытое берётся из земли, а не из воздуха: сколько прибыло на склад, столько ушло из залежи.
    const kind = nodeKindFor(type);
    if (kind !== null && taken > 0) {
      const node = nearestNode(building, kind, live);
      if (node !== null) node.amount = Math.max(0, node.amount - taken);
    }

    // Пометка о простое меняется — значит, здание надо обновить в состоянии.
    if (result.paused !== building.pausedReason) {
      const after: PlacedBuilding = { ...building };
      if (result.paused === undefined) delete after.pausedReason;
      else after.pausedReason = result.paused;
      changes.push({ id: building.id, before: building, after });
    }
  }

  regenerate(live);

  const nodes: NodeChange[] = [];
  for (const node of live) {
    const original = input.nodes.find((source) => source.id === node.id);
    const previous = state.nodes.get(node.id) ?? original?.amount ?? node.amount;
    if (node.amount !== previous) nodes.push({ id: node.id, amount: node.amount, previous });
  }

  return { voxels: [], plantsAdded: [], plantsRemoved: [], buildings: changes, resources, nodes };
}

/**
 * Отрастание залежей (§4 ТЗ): роща поднимается за двое суток, ягоды за сутки, рыба идёт
 * постоянным потоком с потолком. Камень и глина конечны, но их с запасом на несколько
 * полных застроек — тупик невозможен по построению, а не по балансу.
 */
function regenerate(nodes: { amount: number; capacity: number; regenPerDay: number }[]): void {
  for (const node of nodes) {
    if (node.regenPerDay <= 0) continue;
    node.amount = Math.min(node.capacity, node.amount + node.regenPerDay / TICKS_PER_DAY);
  }
}

/**
 * Стройка идёт сама и просто ждёт готовой (устав, п. 4): таймеров с наказанием нет.
 * Жители поблизости ускоряют её, но без них она всё равно закончится.
 */
function advanceConstruction(
  building: PlacedBuilding,
  buildTicks: number,
  input: EconomyInput,
): BuildingChange {
  let helpers = 0;
  for (const villager of input.villagers) {
    const distance = Math.hypot(villager.position.x - building.x, villager.position.z - building.z);
    if (distance <= HELP_RADIUS) helpers += 1;
  }

  const speed = 1 + helpers * HELPER_SPEED;
  const progress = Math.min(1, building.progress + speed / Math.max(1, buildTicks));

  const after: PlacedBuilding = { ...building, progress };
  if (progress >= 1 && building.builtAtTick === undefined) after.builtAtTick = input.tick;

  return { id: building.id, before: building, after };
}
