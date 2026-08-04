import { describe, expect, it } from 'vitest';

import { Material, voxelIndex, WORLD_VOXEL_COUNT } from './voxels';
import { raycastVoxels } from './voxelRay';

function world(cells: [number, number, number][]): (x: number, y: number, z: number) => boolean {
  const voxels = new Uint8Array(WORLD_VOXEL_COUNT);
  for (const [x, y, z] of cells) voxels[voxelIndex(x, y, z)] = Material.STONE;
  return (x, y, z) => voxels[voxelIndex(x, y, z)] !== Material.AIR;
}

describe('raycastVoxels', () => {
  it('находит воксель прямо по курсу', () => {
    const hit = raycastVoxels(20.5, 40.5, 20.5, 1, 0, 0, 30, world([[25, 40, 20]]));
    expect(hit).toMatchObject({ x: 25, y: 40, z: 20 });
  });

  it('возвращает нормаль той грани, через которую вошёл', () => {
    // По нормали ставится соседний воксель, поэтому ошибка здесь означает, что земля
    // насыпается внутрь холма вместо его поверхности.
    const solid = world([[25, 40, 20]]);

    expect(raycastVoxels(20.5, 40.5, 20.5, 1, 0, 0, 30, solid)).toMatchObject({
      nx: -1,
      ny: 0,
      nz: 0,
    });
    expect(raycastVoxels(25.5, 50.5, 20.5, 0, -1, 0, 30, solid)).toMatchObject({
      nx: 0,
      ny: 1,
      nz: 0,
    });
    expect(raycastVoxels(25.5, 40.5, 30.5, 0, 0, -1, 30, solid)).toMatchObject({
      nx: 0,
      ny: 0,
      nz: 1,
    });
  });

  it('не видит ничего в пустоте', () => {
    expect(raycastVoxels(20.5, 40.5, 20.5, 1, 0, 0, 30, world([]))).toBeNull();
  });

  it('уважает дальность', () => {
    const solid = world([[60, 40, 20]]);
    expect(raycastVoxels(20.5, 40.5, 20.5, 1, 0, 0, 10, solid)).toBeNull();
    expect(raycastVoxels(20.5, 40.5, 20.5, 1, 0, 0, 60, solid)).not.toBeNull();
  });

  it('останавливается на первом вокселе, а не на дальнем', () => {
    const hit = raycastVoxels(
      20.5,
      40.5,
      20.5,
      1,
      0,
      0,
      40,
      world([
        [30, 40, 20],
        [25, 40, 20],
      ]),
    );
    expect(hit?.x).toBe(25);
  });

  it('ходит по диагонали без пропусков', () => {
    const hit = raycastVoxels(20.2, 40.2, 20.2, 1, 1, 1, 40, world([[30, 50, 30]]));
    expect(hit).toMatchObject({ x: 30, y: 50, z: 30 });
  });

  it('находит воксель, в котором стоит сам', () => {
    expect(raycastVoxels(20.5, 40.5, 20.5, 1, 0, 0, 30, world([[20, 40, 20]]))).toMatchObject({
      x: 20,
      y: 40,
      z: 20,
    });
  });

  it('нулевое направление не вешает расчёт', () => {
    expect(raycastVoxels(20.5, 40.5, 20.5, 0, 0, 0, 30, world([[20, 41, 20]]))).toBeNull();
  });

  it('луч в небо заканчивается быстро', () => {
    expect(raycastVoxels(20.5, 40.5, 20.5, 0, 1, 0, 200, world([]))).toBeNull();
  });
});
