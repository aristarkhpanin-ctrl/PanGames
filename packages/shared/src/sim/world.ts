import type { PlantId, ResourceId, Vec3, WorldPatch } from '../types';
import { BASE_STORAGE_CAP, startingResources, storageCap, type PlacedBuilding } from './economy';
import { chunkOfVoxel, isInsideWorld, voxelIndex, WORLD_X, WORLD_Z } from '../voxels';

/**
 * Состояние мира сверх процедурной генерации.
 *
 * Хранятся только отличия (§9 ТЗ): остров восстанавливается из сида, а `edits` весит
 * килобайты вместо мегабайт. Растения — отдельный список, потому что они инстансы,
 * а не воксели чанка.
 */
export interface WorldState {
  seed: number;
  /** Индекс вокселя в мире → материал. */
  edits: Map<number, number>;
  plants: PlantInstance[];
  nextPlantId: number;
  buildings: PlacedBuilding[];
  nextBuildingId: number;
  resources: Record<ResourceId, number>;
  /** Вместимость склада: 200 плюс по 150 за амбар (§4 ТЗ). */
  storageCap: number;
  /**
   * Остаток в залежах — тоже разница с генерацией: записан только тот запас,
   * который уже отличается от исходного. Нетронутая залежь здесь не числится.
   */
  nodes: Map<string, number>;
}

export interface PlantInstance {
  id: string;
  kind: PlantId;
  /** Клетка, в которой растёт; y — верхний твёрдый воксель под ним. */
  x: number;
  y: number;
  z: number;
  /** Разброс размера и поворота выводится из сида, а не хранится по полям. */
  seed: number;
}

/** Чтение текущего мира: генерация плюс уже применённые правки. */
export interface WorldReader {
  material(x: number, y: number, z: number): number;
}

/** Одна изменённая клетка. `previous` хранится ради отмены (устав, п. 6). */
export interface VoxelChange {
  index: number;
  material: number;
  previous: number;
}

/**
 * Изменение одного здания. Хранится и «до», и «после»: без прежнего состояния
 * отмену не развернуть, а отменяемость — пункт устава.
 */
export interface BuildingChange {
  id: string;
  /** Пусто — здание только что появилось. */
  before?: PlacedBuilding;
  /** Пусто — здание снесли. */
  after?: PlacedBuilding;
}

/** Изменение остатка в залежи. Прежнее значение хранится ради отмены, как и у вокселей. */
export interface NodeChange {
  id: string;
  amount: number;
  previous: number;
}

/** Что команда сделала с миром. Клиент и сервер применяют это одинаково. */
export interface CommandEffect {
  voxels: VoxelChange[];
  plantsAdded: PlantInstance[];
  plantsRemoved: string[];
  buildings: BuildingChange[];
  /** Изменение склада: положительное — прибыло, отрицательное — списано. */
  resources: Partial<Record<ResourceId, number>>;
  nodes: NodeChange[];
}

export const EMPTY_EFFECT: CommandEffect = {
  voxels: [],
  plantsAdded: [],
  plantsRemoved: [],
  buildings: [],
  resources: {},
  nodes: [],
};

export function createWorldState(seed: number): WorldState {
  return {
    seed,
    edits: new Map(),
    plants: [],
    nextPlantId: 1,
    buildings: [],
    nextBuildingId: 1,
    resources: startingResources(),
    storageCap: BASE_STORAGE_CAP,
    nodes: new Map(),
  };
}

/**
 * Складывает результат команды в состояние. Состояние меняется на месте — оно и есть снимок.
 *
 * `baseline` — воксели, какими их выдал генератор. Если правка вернула клетку к исходному
 * материалу (а именно так работает отмена), запись из разницы удаляется: иначе отменённые
 * действия копились бы в сохранении вечно, хотя мир от генерации уже не отличается.
 */
export function commitEffect(
  state: WorldState,
  effect: CommandEffect,
  baseline?: Uint8Array,
): void {
  for (const change of effect.voxels) {
    if (baseline?.[change.index] === change.material) {
      state.edits.delete(change.index);
    } else {
      state.edits.set(change.index, change.material);
    }
  }

  if (effect.plantsRemoved.length > 0) {
    const removed = new Set(effect.plantsRemoved);
    state.plants = state.plants.filter((plant) => !removed.has(plant.id));
  }

  for (const plant of effect.plantsAdded) {
    state.plants.push(plant);
    const number = Number.parseInt(plant.id.replace('plant-', ''), 10);
    if (Number.isFinite(number) && number >= state.nextPlantId) state.nextPlantId = number + 1;
  }

  for (const change of effect.buildings) {
    const index = state.buildings.findIndex((building) => building.id === change.id);
    if (change.after === undefined) {
      if (index >= 0) state.buildings.splice(index, 1);
      continue;
    }
    if (index >= 0) state.buildings[index] = change.after;
    else state.buildings.push(change.after);

    const number = Number.parseInt(change.id.replace('building-', ''), 10);
    if (Number.isFinite(number) && number >= state.nextBuildingId)
      state.nextBuildingId = number + 1;
  }

  // Вместимость меняется вместе с амбарами, поэтому пересчитывается до раскладки ресурсов.
  state.storageCap = storageCap(state.buildings);

  for (const [id, delta] of Object.entries(effect.resources) as [ResourceId, number][]) {
    const value = state.resources[id] + delta;
    // Переполнение ничего не теряет: производство встанет, а уже добытое останется.
    state.resources[id] = Math.max(0, Math.min(value, state.storageCap));
  }

  for (const change of effect.nodes) state.nodes.set(change.id, change.amount);
}

/** Обратный результат: применив его, мир вернётся в прежнее состояние. */
export function invertEffect(effect: CommandEffect): CommandEffect {
  const resources: Partial<Record<ResourceId, number>> = {};
  for (const [id, delta] of Object.entries(effect.resources) as [ResourceId, number][]) {
    resources[id] = -delta;
  }

  return {
    voxels: effect.voxels.map((change) => ({
      index: change.index,
      material: change.previous,
      previous: change.material,
    })),
    plantsAdded: [],
    plantsRemoved: effect.plantsAdded.map((plant) => plant.id),
    buildings: effect.buildings.map((change) => ({
      id: change.id,
      ...(change.after === undefined ? {} : { before: change.after }),
      ...(change.before === undefined ? {} : { after: change.before }),
    })),
    resources,
    nodes: effect.nodes.map((change) => ({
      id: change.id,
      amount: change.previous,
      previous: change.amount,
    })),
  };
}

/**
 * Чанки, которые надо перестроить после правки.
 *
 * Соседний чанк тоже попадает в список, если правка легла у самой границы: затенение
 * считается по соседям, и без этого на стыке остаётся светлая полоса.
 */
export function dirtyChunks(changes: readonly VoxelChange[]): Set<number> {
  const chunks = new Set<number>();

  // Просто добавляем чанки всех восьми соседей: внутри чанка это тот же самый номер,
  // а у границы — соседний. Множество само отсеивает повторы.
  for (const change of changes) {
    const x = change.index % WORLD_X;
    const z = Math.floor(change.index / WORLD_X) % WORLD_Z;

    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nx >= WORLD_X || nz < 0 || nz >= WORLD_Z) continue;
        chunks.add(chunkOfVoxel(nx, nz));
      }
    }
  }

  return chunks;
}

/** Разница мира в виде, пригодном для хранения и передачи: по чанку на запись (§9 ТЗ). */
export function toWorldPatches(state: WorldState): WorldPatch[] {
  const byChunk = new Map<number, { i: number; mat: number }[]>();

  for (const [index, material] of state.edits) {
    const x = index % WORLD_X;
    const z = Math.floor(index / WORLD_X) % WORLD_Z;
    const chunk = chunkOfVoxel(x, z);
    const list = byChunk.get(chunk) ?? [];
    list.push({ i: index, mat: material });
    byChunk.set(chunk, list);
  }

  return [...byChunk.entries()]
    .map(([chunk, edits]) => ({ chunk, edits: edits.sort((a, b) => a.i - b.i) }))
    .sort((a, b) => a.chunk - b.chunk);
}

export function fromWorldPatches(state: WorldState, patches: readonly WorldPatch[]): void {
  for (const patch of patches) {
    for (const edit of patch.edits) state.edits.set(edit.i, edit.mat);
  }
}

/** Верхний твёрдый воксель столбца. Нужен и посадке, и подсветке, и будущей навигации. */
export function surfaceHeight(world: WorldReader, x: number, z: number, from: number): number {
  for (let y = from; y >= 0; y -= 1) {
    const material = world.material(x, y, z);
    if (material !== 0 && material !== 1) return y;
  }
  return -1;
}

export function vecToIndex(pos: Vec3): number {
  return voxelIndex(pos.x, pos.y, pos.z);
}

export function isInside(pos: Vec3): boolean {
  return isInsideWorld(pos.x, pos.y, pos.z);
}
