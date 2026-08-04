import {
  commitEffect,
  createWorldState,
  storageCap,
  dirtyChunks,
  fromWorldPatches,
  invertEffect,
  toWorldPatches,
  voxelIndex,
  Material,
  type CommandEffect,
  type GeneratedIsland,
  type PlacedBuilding,
  type PlantInstance,
  type ResourceId,
  type WorldPatch,
  type VoxelChange,
  type WorldReader,
  type WorldState,
} from '@gavan/shared';

/** Что поменялось в мире и какие чанки из-за этого устарели. */
export interface WorldUpdate {
  changes: readonly VoxelChange[];
  dirty: Set<number>;
}

/**
 * Живой мир на клиенте: результат генерации плюс уже применённые правки.
 *
 * Массив вокселей держится развёрнутым, потому что по нему идут и мешинг, и пикинг.
 * Сохраняется при этом только разница с генерацией (§9 ТЗ) — она весит килобайты.
 */
export class LiveWorld implements WorldReader {
  readonly voxels: Uint8Array;
  readonly state: WorldState;

  /**
   * Мир, каким его выдал генератор. Нужен, чтобы разница оставалась разницей: отменённая
   * правка исчезает из неё, а не остаётся записью «здесь ровно то же, что и было».
   */
  private readonly baseline: Uint8Array;

  constructor(island: GeneratedIsland) {
    this.voxels = island.voxels;
    this.baseline = island.voxels.slice();
    this.state = createWorldState(island.seed);
  }

  material(x: number, y: number, z: number): number {
    return this.voxels[voxelIndex(x, y, z)] ?? Material.AIR;
  }

  get plants(): readonly PlantInstance[] {
    return this.state.plants;
  }

  /** Применяет результат команды: что изменилось и какие чанки надо перестроить. */
  applyEffect(effect: CommandEffect): WorldUpdate {
    for (const change of effect.voxels) this.voxels[change.index] = change.material;
    commitEffect(this.state, effect, this.baseline);
    return { changes: effect.voxels, dirty: dirtyChunks(effect.voxels) };
  }

  /** Разворачивает команду назад — и для отмены, и для отката при отказе сервера. */
  revertEffect(effect: CommandEffect): WorldUpdate {
    return this.applyEffect(invertEffect(effect));
  }

  patches(): WorldPatch[] {
    return toWorldPatches(this.state);
  }

  /** Восстанавливает мир из сохранённой разницы. */
  restore(saved: {
    patches: readonly WorldPatch[];
    plants: readonly PlantInstance[];
    buildings?: readonly PlacedBuilding[];
    resources?: Partial<Record<ResourceId, number>>;
    nodes?: readonly [string, number][];
  }): WorldUpdate {
    fromWorldPatches(this.state, saved.patches);
    for (const [index, material] of this.state.edits) this.voxels[index] = material;

    this.state.plants = [...saved.plants];
    for (const plant of saved.plants) {
      const number = Number.parseInt(plant.id.replace('plant-', ''), 10);
      if (Number.isFinite(number) && number >= this.state.nextPlantId) {
        this.state.nextPlantId = number + 1;
      }
    }

    this.state.buildings = (saved.buildings ?? []).map((building) => ({ ...building }));
    for (const building of this.state.buildings) {
      const number = Number.parseInt(building.id.replace('building-', ''), 10);
      if (Number.isFinite(number) && number >= this.state.nextBuildingId) {
        this.state.nextBuildingId = number + 1;
      }
    }

    // Вместимость выводится из зданий, а не хранится: амбар мог быть снесён между сессиями.
    this.state.storageCap = storageCap(this.state.buildings);
    for (const [id, amount] of Object.entries(saved.resources ?? {}) as [ResourceId, number][]) {
      this.state.resources[id] = amount;
    }
    this.state.nodes = new Map(saved.nodes ?? []);

    const changes = [...this.state.edits.entries()].map(([index, material]) => ({
      index,
      material,
      previous: material,
    }));
    return { changes, dirty: dirtyChunks(changes) };
  }
}
