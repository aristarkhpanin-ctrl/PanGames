import {
  columnIndex,
  Material,
  SEA_LEVEL,
  voxelIndex,
  WORLD_COLUMN_COUNT,
  WORLD_VOXEL_COUNT,
  WORLD_X,
  WORLD_Z,
} from '../voxels';
import { Biome, classifyBiomes } from './biomes';
import {
  type Curiosity,
  type ResourceNode,
  type TreeInstance,
  placeCuriosity,
  placeResourceNodes,
  scatterTrees,
} from './scatter';
import { generateShape, type IslandShape } from './shape';

/**
 * Генерация острова по сиду (§2.2 ТЗ).
 *
 * Клиент и сервер обязаны получить из одного сида побитово одинаковый результат — иначе они
 * разойдутся в расчётах. Поэтому генератор живёт здесь, в общем пакете, и не имеет права
 * ни на случайность, ни на время: и то и другое приходит аргументами.
 */

export interface GeneratedIsland {
  seed: number;
  /** Плотный массив материалов на весь мир. */
  voxels: Uint8Array;
  /** Y верхнего твёрдого вокселя в каждом столбце. */
  surfaceY: Uint8Array;
  biomes: Uint8Array;
  shape: IslandShape;
  trees: TreeInstance[];
  resourceNodes: ResourceNode[];
  curiosity: Curiosity | null;
}

/** Толщина слоя земли под травой. Ниже начинается камень. */
const DIRT_DEPTH = 3;

/** Глубина, до которой дно песчаное. Дальше — камень. */
const SANDY_FLOOR_DEPTH = 5;

/** Радиус пятна глины вокруг залежи. */
const CLAY_PATCH_RADIUS = 2;

/** Расстояние в массиве вокселей между соседями по вертикали. */
const LAYER_STRIDE = WORLD_COLUMN_COUNT;

export function generateIsland(seed: number): GeneratedIsland {
  const shape = generateShape(seed);
  const biomes = classifyBiomes(shape, seed);

  const trees = scatterTrees(shape, biomes, seed);
  const resourceNodes = placeResourceNodes(shape, biomes, seed);
  const curiosity = placeCuriosity(shape, biomes, seed);

  const voxels = new Uint8Array(WORLD_VOXEL_COUNT);
  const surfaceY = new Uint8Array(WORLD_COLUMN_COUNT);

  fillTerrain(voxels, surfaceY, shape, biomes);
  paintClayPatches(voxels, surfaceY, shape, resourceNodes);

  return { seed, voxels, surfaceY, biomes, shape, trees, resourceNodes, curiosity };
}

function fillTerrain(
  voxels: Uint8Array,
  surfaceY: Uint8Array,
  shape: IslandShape,
  biomes: Uint8Array,
): void {
  for (let z = 0; z < WORLD_Z; z += 1) {
    for (let x = 0; x < WORLD_X; x += 1) {
      const column = columnIndex(x, z);

      // Соседние по вертикали воксели отстоят ровно на слой, поэтому индекс наращивается
      // сложением: умножение на каждый из ~900 000 записываемых вокселей было бы лишним.
      let index = column;

      if (shape.land[column] === 1) {
        const top = SEA_LEVEL + (shape.landHeight[column] ?? 1);
        const biome = biomes[column] ?? Biome.MEADOW;
        const surface = surfaceMaterial(biome);
        const subsurface = biome === Biome.ROCKS ? Material.STONE : Material.DIRT;

        for (let y = 0; y <= top; y += 1) {
          const depth = top - y;
          voxels[index] = depth === 0 ? surface : depth <= DIRT_DEPTH ? subsurface : Material.STONE;
          index += LAYER_STRIDE;
        }

        surfaceY[column] = top;
      } else {
        const depth = shape.waterDepth[column] ?? 1;
        const floor = SEA_LEVEL - depth;
        const floorMaterial = depth <= SANDY_FLOOR_DEPTH ? Material.SAND : Material.STONE;

        for (let y = 0; y <= floor; y += 1) {
          voxels[index] = y === floor ? floorMaterial : Material.STONE;
          index += LAYER_STRIDE;
        }
        for (let y = floor + 1; y <= SEA_LEVEL; y += 1) {
          voxels[index] = Material.WATER;
          index += LAYER_STRIDE;
        }

        surfaceY[column] = floor;
      }
    }
  }
}

function surfaceMaterial(biome: number): number {
  switch (biome) {
    case Biome.BEACH:
      return Material.SAND;
    case Biome.ROCKS:
      return Material.STONE;
    default:
      return Material.GRASS;
  }
}

/** Залежь глины должна быть видна глазом, а не только числиться в данных. */
function paintClayPatches(
  voxels: Uint8Array,
  surfaceY: Uint8Array,
  shape: IslandShape,
  nodes: readonly ResourceNode[],
): void {
  for (const node of nodes) {
    if (node.kind !== 'clay') continue;

    for (let dz = -CLAY_PATCH_RADIUS; dz <= CLAY_PATCH_RADIUS; dz += 1) {
      for (let dx = -CLAY_PATCH_RADIUS; dx <= CLAY_PATCH_RADIUS; dx += 1) {
        if (Math.hypot(dx, dz) > CLAY_PATCH_RADIUS) continue;

        const x = node.x + dx;
        const z = node.z + dz;
        if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) continue;

        const column = columnIndex(x, z);
        if (shape.land[column] !== 1) continue;

        const top = surfaceY[column] ?? 0;
        voxels[voxelIndex(x, top, z)] = Material.CLAY;
        if (top > 0) voxels[voxelIndex(x, top - 1, z)] = Material.CLAY;
      }
    }
  }
}
