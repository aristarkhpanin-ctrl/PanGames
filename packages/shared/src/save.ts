import { storageCap, type PlacedBuilding } from './sim/economy';
import {
  createWorldState,
  fromWorldPatches,
  toWorldPatches,
  type PlantInstance,
  type WorldState,
} from './sim/world';
import type { ResourceId, Villager, WorldPatch } from './types';

/**
 * Снимок острова: состояние мира в виде, пригодном для хранения и передачи (§9 ТЗ).
 *
 * Хранится только разница с процедурной генерацией — остров восстанавливается из сида,
 * поэтому снимок весит килобайты, а не мегабайты. Функции чистые: их одинаково зовут
 * сервер (запись в базу) и клиент (разбор ответа).
 *
 * `version` растёт, когда меняется форма снимка. Загрузчик умеет читать старые версии
 * и поднимать их до текущей: сохранение игрока не должно пропадать из-за нашего рефакторинга.
 */

/** Текущая версия формата снимка. Растёт вместе с формой, а не с содержимым. */
export const SNAPSHOT_VERSION = 2;

export interface WorldSnapshot {
  version: number;
  seed: number;
  patches: WorldPatch[];
  plants: PlantInstance[];
  buildings: PlacedBuilding[];
  resources: Partial<Record<ResourceId, number>>;
  /** Остаток в залежах, отличающийся от исходного: пары «идентификатор — сколько осталось». */
  nodes: [string, number][];
  nextPlantId: number;
  nextBuildingId: number;
}

/**
 * Первая версия — мир до M4: земля и растения, без зданий, склада и залежей.
 * Описана здесь целиком, чтобы загрузчик читал её по типу, а не по догадке.
 */
export interface WorldSnapshotV1 {
  version: 1;
  seed: number;
  patches: WorldPatch[];
  plants: PlantInstance[];
}

export type StoredSnapshot = WorldSnapshot | WorldSnapshotV1;

export function toSnapshot(state: WorldState): WorldSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    seed: state.seed,
    patches: toWorldPatches(state),
    plants: state.plants.map((plant) => ({ ...plant })),
    buildings: state.buildings.map(copyBuilding),
    resources: { ...state.resources },
    // Порядок задаётся явно: снимок одного и того же мира обязан быть одинаковым побайтово.
    nodes: [...state.nodes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    nextPlantId: state.nextPlantId,
    nextBuildingId: state.nextBuildingId,
  };
}

export function fromSnapshot(stored: StoredSnapshot): WorldState {
  const snapshot = upgradeSnapshot(stored);
  const state = createWorldState(snapshot.seed);

  fromWorldPatches(state, snapshot.patches);
  state.plants = snapshot.plants.map((plant) => ({ ...plant }));
  state.buildings = snapshot.buildings.map(copyBuilding);
  state.nodes = new Map(snapshot.nodes);
  state.nextPlantId = snapshot.nextPlantId;
  state.nextBuildingId = snapshot.nextBuildingId;

  for (const [id, amount] of Object.entries(snapshot.resources) as [ResourceId, number][]) {
    state.resources[id] = amount;
  }

  // Вместимость выводится из зданий, а не хранится: снимок не может соврать про склад.
  state.storageCap = storageCap(state.buildings);
  return state;
}

/**
 * Поднимает снимок до текущей версии.
 *
 * Остров первой версии не знал ни зданий, ни залежей; недостающее заполняется пустым.
 * Игрок теряет не мир, а только то, чего в нём тогда и не было.
 */
export function upgradeSnapshot(stored: StoredSnapshot): WorldSnapshot {
  if (isVersionOne(stored)) {
    return {
      version: SNAPSHOT_VERSION,
      seed: stored.seed,
      patches: stored.patches,
      plants: stored.plants,
      buildings: [],
      resources: {},
      nodes: [],
      nextPlantId: nextIdAfter(
        stored.plants.map((plant) => plant.id),
        'plant-',
      ),
      nextBuildingId: 1,
    };
  }

  return stored;
}

/**
 * Версия узнаётся по номеру, а не по наличию полей: номер — договор, а поля могут совпасть
 * случайно. Разбор при этом не падает на снимке, которого мы никогда не видели.
 */
function isVersionOne(stored: StoredSnapshot): stored is WorldSnapshotV1 {
  return stored.version <= 1;
}

/** Снимок жителя. Путь наружу не уходит: он выводится заново и весит больше всего остального. */
export function toVillagerSnapshot(villager: Villager): Villager {
  const copy: Villager = {
    ...villager,
    needs: { ...villager.needs },
    bonds: villager.bonds.map((bond) => ({ ...bond })),
  };
  delete copy.path;
  delete copy.pathIndex;
  return copy;
}

function copyBuilding(building: PlacedBuilding): PlacedBuilding {
  return {
    ...building,
    workers: [...building.workers],
    // Жильцов в первой версии не было: пустой список честнее, чем упавший разбор.
    residents: [...((building.residents as string[] | undefined) ?? [])],
  };
}

function nextIdAfter(ids: readonly string[], prefix: string): number {
  let next = 1;
  for (const id of ids) {
    const number = Number.parseInt(id.replace(prefix, ''), 10);
    if (Number.isFinite(number) && number >= next) next = number + 1;
  }
  return next;
}
