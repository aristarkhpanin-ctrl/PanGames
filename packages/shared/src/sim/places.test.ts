import { describe, expect, it } from 'vitest';

import { columnIndex, Material, voxelIndex } from '../voxels';
import { generateIsland } from '../worldgen/island';
import { buildNavGrid, isWalkable } from './navigation';
import { findLandingSite, findSpawns } from './places';
import { validate } from './validate';
import { createWorldState, type WorldReader } from './world';

/**
 * Место высадки (§11 ТЗ). Первая минута игры целиком опирается на эти координаты, поэтому
 * проверяется главное: лодка стоит на воде, четверо сходят на сушу, а подсвеченная площадка
 * действительно принимает шалаш — подсказка, на которую нельзя нажать, хуже её отсутствия.
 */

const SEEDS = [1, 42, 777, 20_260, 999_999];

describe('место высадки', () => {
  for (const seed of SEEDS) {
    it(`сид ${String(seed)}: берег — суша, причал — вода, площадка ровная`, () => {
      const island = generateIsland(seed);
      const grid = buildNavGrid({
        material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
      });
      const site = findLandingSite(grid, island.shape);

      expect(island.shape.land[columnIndex(site.shore.x, site.shore.z)]).toBe(1);
      expect(isWalkable(grid, site.shore.x, site.shore.z)).toBe(true);

      expect(island.shape.land[columnIndex(site.moor.x, site.moor.z)]).toBe(0);
      expect(island.shape.land[columnIndex(site.offing.x, site.offing.z)]).toBe(0);

      // Лодка приходит из открытого моря, а не всплывает во внутреннем пруду.
      expect(island.shape.openSea[columnIndex(site.offing.x, site.offing.z)]).toBe(1);

      // Море дальше причала: иначе лодка «приплыла» бы, стоя на месте.
      const approach = Math.hypot(site.offing.x - site.moor.x, site.offing.z - site.moor.z);
      expect(approach).toBeGreaterThan(10);
    });

    it(`сид ${String(seed)}: на подсвеченное место встаёт шалаш`, () => {
      const island = generateIsland(seed);
      const reader: WorldReader = {
        material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
      };
      const grid = buildNavGrid(reader);
      const site = findLandingSite(grid, island.shape);

      const state = createWorldState(seed);
      // Дерева на первый шалаш хватает с самого начала — иначе подсказка была бы издевательством.
      expect(state.resources.wood).toBeGreaterThanOrEqual(4);

      expect(
        validate({ t: 'place_building', typeId: 'hut', pos: site.hut, rot: 0 }, state, reader),
      ).toEqual({ ok: true });
    });
  }

  it('одно и то же место при одном сиде', () => {
    const island = generateIsland(42);
    const grid = buildNavGrid({
      material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
    });

    expect(findLandingSite(grid, island.shape)).toEqual(findLandingSite(grid, island.shape));
  });

  it('четверо появляются рядом с местом высадки, а не в середине острова', () => {
    const island = generateIsland(42);
    const grid = buildNavGrid({
      material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
    });
    const site = findLandingSite(grid, island.shape);
    const spawns = findSpawns(grid, 4, site.shore);

    expect(spawns).toHaveLength(4);
    for (const spawn of spawns) {
      expect(Math.hypot(spawn.x - site.shore.x, spawn.z - site.shore.z)).toBeLessThan(14);
      expect(isWalkable(grid, spawn.x, spawn.z)).toBe(true);
    }
  });
});
