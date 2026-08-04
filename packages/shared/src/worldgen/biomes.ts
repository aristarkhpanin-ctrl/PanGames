import { columnIndex, WORLD_COLUMN_COUNT, WORLD_X, WORLD_Z } from '../voxels';
import { createNoise2D, fbm2 } from './noise';
import { createRng, deriveSeed } from './rng';
import { type IslandShape } from './shape';

/**
 * Биомы (§2.2 ТЗ). Остров должен читаться силуэтом: пляж, луг, роща, скала — и мелководье
 * вокруг. Биом — функция высоты, расстояния до воды и одного дополнительного слоя шума.
 */

export const Biome = {
  /** Открытая вода: глубина, где не видно дна. */
  SEA: 0,
  SHALLOWS: 1,
  BEACH: 2,
  MEADOW: 3,
  GROVE: 4,
  ROCKS: 5,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

export const BIOME_COUNT = 6;

/** Биомы, из которых состоит суша. Мелководье и море сюда не входят. */
export const LAND_BIOMES: readonly BiomeId[] = [
  Biome.BEACH,
  Biome.MEADOW,
  Biome.GROVE,
  Biome.ROCKS,
];

/** Глубина, до которой вода считается мелководьем. */
const SHALLOWS_DEPTH = 3;

/**
 * Насколько влажным должно быть место, чтобы там выросла роща.
 *
 * Ноль — не «значение по умолчанию», а подобранная величина: при нём роща и луг делят
 * остров примерно поровну (по 35% суши), и ни один биом не занимает больше половины.
 * При 0.18 луг разрастался до 64%, и остров переставал читаться как «пляж, луг, лес, скала».
 */
const GROVE_MOISTURE = 0;

export function classifyBiomes(shape: IslandShape, seed: number): Uint8Array {
  const moistureNoise = createNoise2D(createRng(deriveSeed(seed, 'moisture')));
  const biomes = new Uint8Array(WORLD_COLUMN_COUNT);

  for (let z = 0; z < WORLD_Z; z += 1) {
    for (let x = 0; x < WORLD_X; x += 1) {
      const index = columnIndex(x, z);

      if (shape.land[index] !== 1) {
        biomes[index] =
          (shape.waterDepth[index] ?? 0) <= SHALLOWS_DEPTH ? Biome.SHALLOWS : Biome.SEA;
        continue;
      }

      const height = shape.landHeight[index] ?? 0;
      const toWater = shape.distToWater[index] ?? 0;

      // Пляж — узкая полоса у самой воды, и только там, где берег пологий.
      if (height <= 2 && toWater <= 3) {
        biomes[index] = Biome.BEACH;
        continue;
      }

      // Скалы — либо высоко, либо круто. Крутизна важна: обрыв должен быть каменным,
      // иначе трава повиснет вертикальной стеной.
      if (height >= 11 || slopeAt(shape, x, z) >= 3) {
        biomes[index] = Biome.ROCKS;
        continue;
      }

      const moisture = fbm2(moistureNoise, x * 0.045, z * 0.045, { octaves: 3 });
      biomes[index] = moisture > GROVE_MOISTURE ? Biome.GROVE : Biome.MEADOW;
    }
  }

  return biomes;
}

/** Наибольший перепад высоты с соседями. */
export function slopeAt(shape: IslandShape, x: number, z: number): number {
  const height = shape.landHeight[columnIndex(x, z)] ?? 0;
  let maximum = 0;

  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dz === 0) continue;
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nx >= WORLD_X || nz < 0 || nz >= WORLD_Z) continue;
      const neighbour = shape.landHeight[columnIndex(nx, nz)] ?? 0;
      maximum = Math.max(maximum, Math.abs(height - neighbour));
    }
  }

  return maximum;
}

export function countBiomes(biomes: Uint8Array): Record<BiomeId, number> {
  const counts: Record<BiomeId, number> = {
    [Biome.SEA]: 0,
    [Biome.SHALLOWS]: 0,
    [Biome.BEACH]: 0,
    [Biome.MEADOW]: 0,
    [Biome.GROVE]: 0,
    [Biome.ROCKS]: 0,
  };

  for (const value of biomes) {
    // Приведение безопасно: массив заполняется только значениями Biome.
    counts[value as BiomeId] += 1;
  }

  return counts;
}
