import { columnIndex, SEA_LEVEL, WORLD_X, WORLD_Z } from '../voxels';
import { Biome, slopeAt } from './biomes';
import { type Rng, createRng, deriveSeed } from './rng';
import { type IslandShape } from './shape';

/**
 * Что стоит на острове помимо земли: деревья, ресурсные точки и одна диковинка.
 *
 * Деревья и декор — не воксели чанка, а инстансы (§2.4 ТЗ): так их можно рисовать сотнями
 * без роста числа вызовов отрисовки, и они не заставляют перестраивать меш при посадке.
 */

export type TreeKind = 'broadleaf' | 'pine' | 'palm';

export interface TreeInstance {
  /** Координата верхнего твёрдого вокселя под деревом. */
  x: number;
  y: number;
  z: number;
  kind: TreeKind;
  scale: number;
  /** Поворот вокруг вертикали в радианах. */
  rotation: number;
}

export type ResourceNodeKind = 'stone' | 'clay' | 'sand' | 'berry' | 'fish';

export interface ResourceNode {
  id: string;
  kind: ResourceNodeKind;
  x: number;
  y: number;
  z: number;
  amount: number;
  capacity: number;
  /** Сколько восстанавливается за игровой день. 0 — залежь конечна. */
  regenPerDay: number;
}

export type CuriosityKind = 'giant_tree' | 'stone_arch' | 'warm_spring' | 'sunken_boat';

export interface Curiosity {
  kind: CuriosityKind;
  x: number;
  y: number;
  z: number;
}

/**
 * Запасы залежей. Камня и глины хватает примерно на четырёхкратную полную застройку (§4 ТЗ):
 * тупик в этой игре невозможен по построению, а не по балансу.
 */
const NODE_SPEC: Record<
  ResourceNodeKind,
  { count: number; capacity: number; regenPerDay: number; spacing: number }
> = {
  stone: { count: 6, capacity: 1400, regenPerDay: 0, spacing: 11 },
  clay: { count: 4, capacity: 900, regenPerDay: 0, spacing: 14 },
  sand: { count: 5, capacity: 700, regenPerDay: 40, spacing: 12 },
  berry: { count: 8, capacity: 40, regenPerDay: 40, spacing: 9 },
  fish: { count: 3, capacity: 60, regenPerDay: 60, spacing: 8 },
};

/**
 * Вероятность дерева в клетке по биому. Роща — густая, луг — редкие одиночки.
 *
 * Числа занижены осознанно: при вчетверо большей плотности кроны смыкались в сплошной
 * тёмный ковёр, и остров переставал читаться. Между деревьями должна быть видна земля.
 */
const TREE_CHANCE: Partial<Record<number, number>> = {
  [Biome.GROVE]: 0.2,
  [Biome.MEADOW]: 0.03,
  [Biome.BEACH]: 0.03,
};

/**
 * Свободных клеток вокруг дерева. Крона шире двух метров, то есть четырёх вокселей,
 * поэтому при меньшем расстоянии деревья срастаются в сплошной полог и остров пропадает.
 */
const TREE_SPACING = 3;

export function scatterTrees(shape: IslandShape, biomes: Uint8Array, seed: number): TreeInstance[] {
  const rng = createRng(deriveSeed(seed, 'trees'));
  const trees: TreeInstance[] = [];
  const occupied = new Uint8Array(WORLD_X * WORLD_Z);

  for (let z = 1; z < WORLD_Z - 1; z += 1) {
    for (let x = 1; x < WORLD_X - 1; x += 1) {
      const index = columnIndex(x, z);
      if (shape.land[index] !== 1) continue;

      const biome = biomes[index] ?? Biome.SEA;
      const chance = TREE_CHANCE[biome];
      if (chance === undefined || !rng.chance(chance)) continue;

      // На круче дерево смотрится приклеенным к стене, а не растущим.
      if (slopeAt(shape, x, z) >= 2) continue;
      if (isOccupied(occupied, x, z)) continue;

      markOccupied(occupied, x, z);

      trees.push({
        x,
        y: SEA_LEVEL + (shape.landHeight[index] ?? 0),
        z,
        kind: treeKindFor(biome, shape.distToWater[index] ?? 0),
        scale: rng.range(0.8, 1.25),
        rotation: rng.range(0, Math.PI * 2),
      });
    }
  }

  return trees;
}

function treeKindFor(biome: number, distToWater: number): TreeKind {
  if (biome === Biome.BEACH || distToWater <= 3) return 'palm';
  if (biome === Biome.MEADOW) return 'pine';
  return 'broadleaf';
}

export function placeResourceNodes(
  shape: IslandShape,
  biomes: Uint8Array,
  seed: number,
): ResourceNode[] {
  const nodes: ResourceNode[] = [];

  for (const kind of Object.keys(NODE_SPEC) as ResourceNodeKind[]) {
    const spec = NODE_SPEC[kind];
    const rng = createRng(deriveSeed(seed, `node:${kind}`));
    const candidates = candidatesFor(kind, shape, biomes);
    shuffle(candidates, rng);

    const chosen: { x: number; z: number }[] = [];
    for (const index of candidates) {
      if (chosen.length >= spec.count) break;
      const x = index % WORLD_X;
      const z = (index - x) / WORLD_X;
      if (chosen.some((p) => Math.hypot(p.x - x, p.z - z) < spec.spacing)) continue;
      chosen.push({ x, z });
    }

    // Если подходящих мест мало, доукладываем без соблюдения расстояния: остров без глины
    // приводит к тупику, а тупик запрещён.
    for (const index of candidates) {
      if (chosen.length >= spec.count) break;
      const x = index % WORLD_X;
      const z = (index - x) / WORLD_X;
      if (chosen.some((p) => p.x === x && p.z === z)) continue;
      chosen.push({ x, z });
    }

    chosen.forEach((position, order) => {
      const index = columnIndex(position.x, position.z);
      const isWater = shape.land[index] !== 1;
      nodes.push({
        id: `${kind}-${String(order)}`,
        kind,
        x: position.x,
        z: position.z,
        y: isWater
          ? SEA_LEVEL - (shape.waterDepth[index] ?? 1)
          : SEA_LEVEL + (shape.landHeight[index] ?? 0),
        amount: spec.capacity,
        capacity: spec.capacity,
        regenPerDay: spec.regenPerDay,
      });
    });
  }

  return nodes;
}

function candidatesFor(kind: ResourceNodeKind, shape: IslandShape, biomes: Uint8Array): number[] {
  const result: number[] = [];

  for (let z = 2; z < WORLD_Z - 2; z += 1) {
    for (let x = 2; x < WORLD_X - 2; x += 1) {
      const index = columnIndex(x, z);
      const biome = biomes[index] ?? Biome.SEA;
      const isLand = shape.land[index] === 1;

      const suitable = (() => {
        switch (kind) {
          case 'stone':
            return isLand && biome === Biome.ROCKS;
          case 'clay':
            // Глина у воды — там, где по замыслу ручей выносит её к берегу (§2.2 ТЗ).
            return isLand && (shape.distToWater[index] ?? 99) <= 4 && biome !== Biome.ROCKS;
          case 'sand':
            return isLand && biome === Biome.BEACH;
          case 'berry':
            return isLand && biome === Biome.GROVE;
          case 'fish':
            // Косяки держатся в бухте: там мелко и спокойно.
            return (
              !isLand &&
              shape.openSea[index] === 1 &&
              Math.hypot(x - shape.bay.x, z - shape.bay.z) < shape.bay.radius * 1.4
            );
        }
      })();

      if (suitable) result.push(index);
    }
  }

  return result;
}

/**
 * Одна «диковинка» на остров (§2.2 ТЗ) — точка притяжения для декорирования
 * и первая тема в дневнике.
 */
export function placeCuriosity(
  shape: IslandShape,
  biomes: Uint8Array,
  seed: number,
): Curiosity | null {
  const rng = createRng(deriveSeed(seed, 'curiosity'));
  const kinds: [CuriosityKind, ...CuriosityKind[]] = [
    'giant_tree',
    'stone_arch',
    'warm_spring',
    'sunken_boat',
  ];

  // Пробуем задуманный вид, а если места для него на этом острове нет — следующий по кругу.
  const first = rng.int(0, kinds.length - 1);
  for (let attempt = 0; attempt < kinds.length; attempt += 1) {
    const kind = kinds[(first + attempt) % kinds.length];
    if (kind === undefined) continue;

    const spots = curiositySpots(kind, shape, biomes);
    if (spots.length === 0) continue;

    const index = spots[rng.int(0, spots.length - 1)];
    if (index === undefined) continue;

    const x = index % WORLD_X;
    const z = (index - x) / WORLD_X;
    const isWater = shape.land[index] !== 1;

    return {
      kind,
      x,
      z,
      y: isWater
        ? SEA_LEVEL - (shape.waterDepth[index] ?? 1)
        : SEA_LEVEL + (shape.landHeight[index] ?? 0),
    };
  }

  return null;
}

function curiositySpots(kind: CuriosityKind, shape: IslandShape, biomes: Uint8Array): number[] {
  const result: number[] = [];

  for (let z = 6; z < WORLD_Z - 6; z += 1) {
    for (let x = 6; x < WORLD_X - 6; x += 1) {
      const index = columnIndex(x, z);
      const biome = biomes[index] ?? Biome.SEA;
      const isLand = shape.land[index] === 1;

      const suitable = (() => {
        switch (kind) {
          case 'giant_tree':
            return isLand && biome === Biome.GROVE && slopeAt(shape, x, z) <= 1;
          case 'stone_arch':
            return isLand && biome === Biome.ROCKS;
          case 'warm_spring':
            return isLand && biome === Biome.MEADOW && (shape.distToWater[index] ?? 0) >= 6;
          case 'sunken_boat':
            return (
              !isLand &&
              biome === Biome.SHALLOWS &&
              shape.openSea[index] === 1 &&
              (shape.distToLand[index] ?? 99) <= 4
            );
        }
      })();

      if (suitable) result.push(index);
    }
  }

  return result;
}

function isOccupied(occupied: Uint8Array, x: number, z: number): boolean {
  return occupied[columnIndex(x, z)] === 1;
}

/** Резервирует клетку и её соседей: деревья не должны срастаться в сплошную стену. */
function markOccupied(occupied: Uint8Array, x: number, z: number): void {
  for (let dz = -TREE_SPACING; dz <= TREE_SPACING; dz += 1) {
    for (let dx = -TREE_SPACING; dx <= TREE_SPACING; dx += 1) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nx >= WORLD_X || nz < 0 || nz >= WORLD_Z) continue;
      occupied[columnIndex(nx, nz)] = 1;
    }
  }
}

function shuffle(items: number[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const tmp = items[i] ?? 0;
    items[i] = items[j] ?? 0;
    items[j] = tmp;
  }
}
