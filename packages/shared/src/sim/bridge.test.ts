import { describe, expect, it } from 'vitest';

import { Material, SEA_LEVEL, voxelIndex } from '../voxels';
import { generateIsland } from '../worldgen/island';
import { applyCommand } from './apply';
import { buildNavGrid, findPath, isWalkable } from './navigation';
import { createWorldState, commitEffect, type WorldReader } from './world';
import { validate } from './validate';

/**
 * Мостки и островки (M10).
 *
 * Проверяется главное: до островка нельзя дойти, пока моста нет; настил кладётся только
 * от берега и только над водой; а положенный мост делает островок достижимым по-настоящему —
 * то есть по нему находится путь.
 */

const SEED = 42;
const island = generateIsland(SEED);

/** Живая копия вокселей: мост кладётся прямо в неё, как это делает мир. */
const voxels = island.voxels.slice();
const reader: WorldReader = {
  material: (x, y, z) => voxels[voxelIndex(x, y, z)] ?? Material.AIR,
};

const islet = island.shape.islets[0];

/**
 * Дорожка мостков от берега к островку: клетки идут строго по осям, без диагоналей.
 *
 * Диагональ здесь не случайно запрещена: по диагональному настилу житель не пройдёт —
 * граф навигации ходит по четырём сторонам. Настил, по которому нельзя пройти, был бы
 * не мостом, а декорацией.
 */
function bridgeCells(): { x: number; y: number; z: number }[] {
  if (islet === undefined) throw new Error('у сида 42 нет островков');

  const toCenter = Math.atan2(80 - islet.z, 80 - islet.x);
  let start: { x: number; z: number } | null = null;

  // Идём от островка к центру: последняя вода перед сушей и есть клетка у главного берега.
  for (let step = 1; step < 60; step += 1) {
    const x = Math.round(islet.x + Math.cos(toCenter) * step);
    const z = Math.round(islet.z + Math.sin(toCenter) * step);
    if (reader.material(x, SEA_LEVEL, z) === Material.WATER) start = { x, z };
    else if (start !== null) break;
  }

  if (start === null) throw new Error('пролива не нашлось');

  const cells: { x: number; y: number; z: number }[] = [];
  let at = { ...start };

  for (let i = 0; i < 40; i += 1) {
    if (reader.material(at.x, SEA_LEVEL, at.z) !== Material.WATER) break;
    cells.push({ x: at.x, y: SEA_LEVEL + 1, z: at.z });

    const dx = islet.x - at.x;
    const dz = islet.z - at.z;
    if (dx === 0 && dz === 0) break;
    at =
      Math.abs(dx) >= Math.abs(dz)
        ? { x: at.x + Math.sign(dx), z: at.z }
        : { x: at.x, z: at.z + Math.sign(dz) };
  }

  return cells;
}

describe('островки', () => {
  it('есть у каждого сида и лежат в воде', () => {
    for (const seed of [1, 42, 777, 20_260]) {
      const other = generateIsland(seed);
      expect(other.shape.islets.length).toBeGreaterThan(0);
      for (const spot of other.shape.islets) {
        expect(other.shape.land[spot.x + 160 * spot.z]).toBe(1);
      }
    }
  });

  it('до островка не дойти, пока моста нет', () => {
    if (islet === undefined) throw new Error('нет островков');
    const grid = buildNavGrid(reader);

    expect(isWalkable(grid, islet.x, islet.z)).toBe(true);
    // Житель стоит в середине острова; путь на островок не находится.
    expect(findPath(grid, { x: 80, z: 80 }, { x: islet.x, z: islet.z })).toBeNull();
  });
});

describe('мостки', () => {
  it('кладутся только над водой', () => {
    const state = createWorldState(SEED);
    const onLand = { x: 80, y: SEA_LEVEL + 1, z: 80 };

    expect(
      validate({ t: 'terraform', edits: [{ pos: onLand, mat: Material.PLANK }] }, state, reader),
    ).toEqual({ ok: false, reason: 'needs_water' });
  });

  it('не висят в открытом море: нужна опора', () => {
    if (islet === undefined) throw new Error('нет островков');
    const state = createWorldState(SEED);

    // Точка ровно между островком и берегом — вода, но опереться не на что.
    const middle = { x: Math.round((islet.x + 80) / 2), y: SEA_LEVEL + 1, z: Math.round((islet.z + 80) / 2) };
    const verdict = validate(
      { t: 'terraform', edits: [{ pos: middle, mat: Material.PLANK }] },
      state,
      reader,
    );

    expect(verdict.ok).toBe(false);
  });

  it('от берега кладутся и делают островок достижимым', () => {
    if (islet === undefined) throw new Error('нет островков');
    const state = createWorldState(SEED);

    const cells = bridgeCells();
    expect(cells.length).toBeGreaterThan(2);

    for (const at of cells) {
      const command = { t: 'terraform' as const, edits: [{ pos: at, mat: Material.PLANK }] };
      expect(validate(command, state, reader), `клетка ${String(at.x)},${String(at.z)}`).toEqual({
        ok: true,
      });

      commitEffect(state, applyCommand(command, state, reader));
      voxels[voxelIndex(at.x, at.y, at.z)] = Material.PLANK;
    }

    // Путь на островок теперь находится — вот ради чего всё и делалось.
    const grid = buildNavGrid(reader);
    const path = findPath(grid, { x: 80, z: 80 }, { x: islet.x, z: islet.z });
    expect(path, 'после моста путь на островок должен находиться').not.toBeNull();
  });
});
