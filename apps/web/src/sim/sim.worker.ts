import {
  buildNavGrid,
  columnIndex,
  createStartingVillagers,
  isWalkable,
  Material,
  rebuildNavArea,
  simulateTick,
  voxelIndex,
  WORLD_X,
  WORLD_Z,
  type NavGrid,
  type PlacedBuilding,
  type SimState,
  type Vec3,
  type Villager,
  type WorldReader,
} from '@gavan/shared';

/**
 * Воркер симуляции: навигационная сетка, поиск пути и тик жителей (§12 ТЗ).
 *
 * Здесь же живёт A\*: главный поток не должен ждать поиска пути ни при каких обстоятельствах.
 * Наружу уезжают только позиции и состояния — всё остальное остаётся внутри.
 */

export interface SimInit {
  type: 'init';
  voxels: ArrayBuffer;
  seed: number;
  islandId: string;
  /** С какого тика продолжаем. Часы жителей и часы солнца обязаны совпадать. */
  tick: number;
}

export interface SimEdit {
  type: 'edit';
  indices: Uint32Array;
  materials: Uint8Array;
}

export interface SimStep {
  type: 'tick';
}

/** Здания и зелень острова: в них живут, в них работают, вокруг них уютно. */
export interface SimWorld {
  type: 'world';
  buildings: PlacedBuilding[];
  plants: { x: number; z: number }[];
}

export type SimIncoming = SimInit | SimEdit | SimStep | SimWorld;

export interface SimSnapshot {
  type: 'snapshot';
  tick: number;
  villagers: Villager[];
}

let voxels: Uint8Array | null = null;
let grid: NavGrid | null = null;
let state: SimState | null = null;
let scenicSpots: Vec3[] = [];
let buildings: PlacedBuilding[] = [];
let plants: { x: number; z: number }[] = [];
let seed = 0;

const reader: WorldReader = {
  material: (x, y, z) => voxels?.[voxelIndex(x, y, z)] ?? Material.AIR,
};

/** Места, куда ходят любоваться: проходимые клетки у самой воды. */
function findScenicSpots(navGrid: NavGrid): Vec3[] {
  const spots: Vec3[] = [];
  for (let z = 2; z < WORLD_Z - 2 && spots.length < 40; z += 4) {
    for (let x = 2; x < WORLD_X - 2 && spots.length < 40; x += 4) {
      if (!isWalkable(navGrid, x, z)) continue;
      // У воды: хотя бы один сосед непроходим — значит, там берег.
      const nearWater =
        !isWalkable(navGrid, x + 2, z) ||
        !isWalkable(navGrid, x - 2, z) ||
        !isWalkable(navGrid, x, z + 2) ||
        !isWalkable(navGrid, x, z - 2);
      if (!nearWater) continue;
      spots.push({ x, y: (navGrid.height[columnIndex(x, z)] ?? 0) + 1, z });
    }
  }
  return spots;
}

/** Четыре проходимые клетки поближе к бухте: там причалила лодка. */
function findSpawns(navGrid: NavGrid): Vec3[] {
  const spawns: Vec3[] = [];
  for (let radius = 0; radius < 80 && spawns.length < 4; radius += 2) {
    for (let angle = 0; angle < 16 && spawns.length < 4; angle += 1) {
      const x = Math.round(WORLD_X / 2 + Math.cos((angle / 16) * Math.PI * 2) * radius);
      const z = Math.round(WORLD_Z / 2 + Math.sin((angle / 16) * Math.PI * 2) * radius);
      if (!isWalkable(navGrid, x, z)) continue;
      if (spawns.some((spawn) => Math.hypot(spawn.x - x, spawn.z - z) < 3)) continue;
      spawns.push({ x, y: (navGrid.height[columnIndex(x, z)] ?? 0) + 1, z });
    }
  }
  return spawns;
}

self.onmessage = (event: MessageEvent<SimIncoming>): void => {
  const message = event.data;

  if (message.type === 'init') {
    voxels = new Uint8Array(message.voxels);
    seed = message.seed;
    grid = buildNavGrid(reader);
    scenicSpots = findScenicSpots(grid);
    state = {
      tick: message.tick,
      villagers: createStartingVillagers(seed, message.islandId, findSpawns(grid)),
    };
    postSnapshot();
    return;
  }

  if (message.type === 'world') {
    buildings = message.buildings;
    plants = message.plants;
    return;
  }

  if (message.type === 'edit') {
    if (voxels === null || grid === null) return;

    let minX = WORLD_X;
    let minZ = WORLD_Z;
    let maxX = 0;
    let maxZ = 0;

    for (let i = 0; i < message.indices.length; i += 1) {
      const index = message.indices[i] ?? 0;
      voxels[index] = message.materials[i] ?? 0;

      const x = index % WORLD_X;
      const z = Math.floor(index / WORLD_X) % WORLD_Z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    // Перестраиваем только задетый кусок графа — с запасом в клетку на перепады высот.
    if (message.indices.length > 0) {
      rebuildNavArea(grid, reader, minX - 1, minZ - 1, maxX + 1, maxZ + 1);
    }
    return;
  }

  if (state === null || grid === null) return;
  state = simulateTick(state, { grid, scenicSpots, seed, buildings, plants }).state;
  postSnapshot();
};

function postSnapshot(): void {
  if (state === null) return;
  const snapshot: SimSnapshot = {
    type: 'snapshot',
    tick: state.tick,
    // Путь наружу не отдаём: клиенту нужны позиция, состояние и настроение,
    // а маршрут из сотни клеток пришлось бы копировать каждые десять секунд.
    villagers: state.villagers.map((villager) => {
      const copy = { ...villager };
      delete copy.path;
      delete copy.pathIndex;
      return copy;
    }),
  };
  self.postMessage(snapshot);
}
