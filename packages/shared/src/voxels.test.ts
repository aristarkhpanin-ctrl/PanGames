import { describe, expect, it } from 'vitest';

import {
  CHUNK_COUNT,
  CHUNK_X,
  CHUNK_Z,
  CHUNKS_X,
  chunkIndex,
  chunkOfVoxel,
  chunkOrigin,
  isFlower,
  isInsideWorld,
  isOpaque,
  isSolid,
  Material,
  MATERIAL_COUNT,
  SEA_LEVEL,
  voxelIndex,
  WORLD_VOXEL_COUNT,
  WORLD_X,
  WORLD_Y,
  WORLD_Z,
} from './voxels';

describe('размеры мира', () => {
  it('совпадают с §2 ТЗ', () => {
    expect([WORLD_X, WORLD_Y, WORLD_Z]).toEqual([160, 96, 160]);
    expect(SEA_LEVEL).toBe(32);
    expect([CHUNK_X, CHUNK_Z]).toEqual([32, 32]);
    expect(CHUNK_COUNT).toBe(25);
  });

  it('мир делится на чанки без остатка', () => {
    expect(WORLD_X % CHUNK_X).toBe(0);
    expect(WORLD_Z % CHUNK_Z).toBe(0);
  });
});

describe('индексация вокселей', () => {
  it('взаимно однозначна', () => {
    const seen = new Set<number>();
    for (let y = 0; y < WORLD_Y; y += 7) {
      for (let z = 0; z < WORLD_Z; z += 5) {
        for (let x = 0; x < WORLD_X; x += 3) {
          const index = voxelIndex(x, y, z);
          expect(seen.has(index)).toBe(false);
          seen.add(index);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(WORLD_VOXEL_COUNT);
        }
      }
    }
  });

  it('соседи по x лежат в памяти подряд', () => {
    // От этого зависит скорость мешинга и построения навигационной сетки.
    expect(voxelIndex(5, 10, 20) + 1).toBe(voxelIndex(6, 10, 20));
  });

  it('границы мира определяются верно', () => {
    expect(isInsideWorld(0, 0, 0)).toBe(true);
    expect(isInsideWorld(WORLD_X - 1, WORLD_Y - 1, WORLD_Z - 1)).toBe(true);
    expect(isInsideWorld(-1, 0, 0)).toBe(false);
    expect(isInsideWorld(0, WORLD_Y, 0)).toBe(false);
    expect(isInsideWorld(0, 0, WORLD_Z)).toBe(false);
  });
});

describe('чанки', () => {
  it('номер и начало чанка согласованы', () => {
    for (let index = 0; index < CHUNK_COUNT; index += 1) {
      const origin = chunkOrigin(index);
      expect(chunkIndex(origin.x / CHUNK_X, origin.z / CHUNK_Z)).toBe(index);
    }
  });

  it('каждый воксель попадает в свой чанк', () => {
    for (let z = 0; z < WORLD_Z; z += 11) {
      for (let x = 0; x < WORLD_X; x += 9) {
        const index = chunkOfVoxel(x, z);
        const origin = chunkOrigin(index);
        expect(x).toBeGreaterThanOrEqual(origin.x);
        expect(x).toBeLessThan(origin.x + CHUNK_X);
        expect(z).toBeGreaterThanOrEqual(origin.z);
        expect(z).toBeLessThan(origin.z + CHUNK_Z);
      }
    }
  });

  it('чанки покрывают весь мир', () => {
    expect(CHUNKS_X * CHUNK_X).toBe(WORLD_X);
  });
});

describe('свойства материалов', () => {
  it('воздух и вода проходимы, остальное — нет', () => {
    expect(isSolid(Material.AIR)).toBe(false);
    expect(isSolid(Material.WATER)).toBe(false);
    expect(isSolid(Material.GRASS)).toBe(true);
    expect(isSolid(Material.STONE)).toBe(true);
  });

  it('стекло и цветы не перекрывают обзор', () => {
    expect(isOpaque(Material.GLASS)).toBe(false);
    expect(isOpaque(Material.FLOWER_PINK)).toBe(false);
    expect(isOpaque(Material.STONE)).toBe(true);
  });

  it('цветы распознаются все', () => {
    expect(isFlower(Material.FLOWER_WHITE)).toBe(true);
    expect(isFlower(Material.FLOWER_PINK)).toBe(true);
    expect(isFlower(Material.FLOWER_AMBER)).toBe(true);
    expect(isFlower(Material.GRASS)).toBe(false);
  });

  it('количество материалов совпадает со списком', () => {
    expect(Object.keys(Material)).toHaveLength(MATERIAL_COUNT);
  });

  it('значения материалов уникальны и не менялись', () => {
    // Значения попадают в сохранённые миры: менять их задним числом нельзя.
    const values = Object.values(Material);
    expect(new Set(values).size).toBe(values.length);
    expect(Material.AIR).toBe(0);
    expect(Material.WATER).toBe(1);
    expect(Material.GRASS).toBe(4);
  });
});
