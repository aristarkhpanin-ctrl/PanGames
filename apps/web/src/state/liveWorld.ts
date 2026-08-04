import {
  commitEffect,
  createWorldState,
  dirtyChunks,
  invertEffect,
  toWorldPatches,
  voxelIndex,
  Material,
  type CommandEffect,
  type GeneratedIsland,
  type PlantInstance,
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
 * Живой мир на клиенте: результат генерации плюс правки, приехавшие с сервера.
 *
 * Массив вокселей держится развёрнутым, потому что по нему идут и мешинг, и пикинг.
 * По сети при этом ходит только разница с генерацией (§9 ТЗ) — она весит килобайты.
 */
export class LiveWorld implements WorldReader {
  readonly voxels: Uint8Array;
  state: WorldState;

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

  /**
   * Принимает состояние, посчитанное сервером: оно и есть правда (§9 ТЗ).
   *
   * Воксели переписываются под новое состояние — и те, что появились, и те, что вернулись
   * к исходному виду; иначе на экране осталась бы яма, которой в мире уже нет.
   */
  adopt(state: WorldState): WorldUpdate {
    const changes: VoxelChange[] = [];

    for (const [index, material] of this.state.edits) {
      if (state.edits.get(index) === material) continue;
      const restored = this.baseline[index] ?? Material.AIR;
      this.voxels[index] = restored;
      changes.push({ index, material: restored, previous: material });
    }

    for (const [index, material] of state.edits) {
      if (this.voxels[index] === material) continue;
      changes.push({ index, material, previous: this.voxels[index] ?? Material.AIR });
      this.voxels[index] = material;
    }

    this.state = state;
    return { changes, dirty: dirtyChunks(changes) };
  }
}
