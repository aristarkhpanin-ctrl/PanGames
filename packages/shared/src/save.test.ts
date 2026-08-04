import { describe, expect, it } from 'vitest';

import { applyCommand } from './sim/apply';
import { createStartingVillagers } from './sim/villager';
import { commitEffect, createWorldState, type WorldReader } from './sim/world';
import {
  fromSnapshot,
  toSnapshot,
  toVillagerSnapshot,
  type StoredSnapshot,
  type WorldSnapshotV1,
} from './save';
import { Material, voxelIndex } from './voxels';
import { generateIsland } from './worldgen/island';
import type { PlacedBuilding, ResourceId } from './index';

/** Снимок уезжает в базу через JSON, поэтому и в тесте он проходит тот же путь. */
function roundTrip(snapshot: StoredSnapshot): StoredSnapshot {
  return parse(JSON.stringify(snapshot));
}

function parse(raw: string): StoredSnapshot {
  // Разбор чужого JSON — единственное место, где приведение к типу честно: он и есть граница.
  return JSON.parse(raw) as StoredSnapshot;
}

const SEED = 11;
const island = generateIsland(SEED);
const reader: WorldReader = {
  material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
};

/** Мир с правками земли, растениями, зданиями и початой залежью. */
function livedInWorld() {
  const state = createWorldState(SEED);

  commitEffect(
    state,
    applyCommand(
      {
        t: 'terraform',
        edits: [
          { pos: { x: 60, y: 20, z: 60 }, mat: Material.PATH },
          { pos: { x: 61, y: 20, z: 60 }, mat: Material.PATH },
        ],
      },
      state,
      reader,
    ),
  );

  state.plants.push({ id: 'plant-1', kind: 'flower', x: 62, y: 20, z: 60, seed: 7 });
  state.nextPlantId = 2;
  state.buildings.push({
    id: 'building-1',
    typeId: 'hut',
    x: 60,
    y: 21,
    z: 62,
    rotation: 1,
    level: 2,
    workers: [],
    residents: ['villager-1'],
    progress: 1,
    builtAtTick: 42,
  });
  state.nextBuildingId = 2;
  state.nodes.set('wood-0', 512.5);
  state.resources.wood = 37;
  state.resources.plank = 4;

  return state;
}

describe('снимок мира', () => {
  it('переживает запись и чтение без потерь', () => {
    const before = livedInWorld();
    const after = fromSnapshot(roundTrip(toSnapshot(before)));

    expect(after.seed).toBe(before.seed);
    expect([...after.edits.entries()].sort()).toEqual([...before.edits.entries()].sort());
    expect(after.plants).toEqual(before.plants);
    expect(after.buildings).toEqual(before.buildings);
    expect(after.resources).toEqual(before.resources);
    expect([...after.nodes.entries()]).toEqual([...before.nodes.entries()]);
    expect(after.nextPlantId).toBe(before.nextPlantId);
    expect(after.nextBuildingId).toBe(before.nextBuildingId);
  });

  it('один и тот же мир даёт побайтово один и тот же снимок', () => {
    const first = JSON.stringify(toSnapshot(livedInWorld()));
    const second = JSON.stringify(toSnapshot(fromSnapshot(parse(first))));
    expect(second).toBe(first);
  });

  it('вместимость склада не хранится, а выводится из зданий', () => {
    const state = createWorldState(SEED);
    state.buildings.push({
      id: 'building-1',
      typeId: 'granary',
      x: 10,
      y: 10,
      z: 10,
      rotation: 0,
      level: 1,
      workers: [],
      residents: [],
      progress: 1,
    });

    const restored = fromSnapshot(toSnapshot(state));
    expect(restored.storageCap).toBe(350);
  });

  it('читает снимок первой версии и поднимает его до текущей', () => {
    const old: WorldSnapshotV1 = {
      version: 1,
      seed: SEED,
      patches: [{ chunk: 3, edits: [{ i: 12345, mat: Material.PATH }] }],
      plants: [{ id: 'plant-4', kind: 'flower', x: 5, y: 6, z: 7, seed: 1 }],
    };

    const state = fromSnapshot(old);
    expect(state.edits.get(12345)).toBe(Material.PATH);
    expect(state.plants).toHaveLength(1);
    expect(state.buildings).toEqual([]);
    // Номера продолжаются с того места, где остановился прежний мир.
    expect(state.nextPlantId).toBe(5);
    expect(toSnapshot(state).version).toBe(2);
  });

  it('полный остров укладывается в разумный объём', () => {
    const state = createWorldState(SEED);

    // 250 зданий — потолок §12 ТЗ.
    for (let i = 0; i < 250; i += 1) {
      const building: PlacedBuilding = {
        id: `building-${String(i + 1)}`,
        typeId: 'cottage',
        x: 20 + (i % 40),
        y: 20,
        z: 20 + Math.floor(i / 40),
        rotation: (i % 4) as 0 | 1 | 2 | 3,
        level: 3,
        workers: [`villager-${String(i % 60)}`],
        residents: [`villager-${String((i + 1) % 60)}`],
        progress: 1,
        builtAtTick: i * 7,
      };
      state.buildings.push(building);
    }

    // Дорожки и подкопы вокруг: примерно столько земли трогает игрок за долгую игру.
    for (let i = 0; i < 20000; i += 1) {
      state.edits.set(i * 37, Material.PATH);
    }
    for (const id of ['wood-0', 'stone-1', 'clay-2']) state.nodes.set(id, 123.25);
    for (const id of Object.keys(state.resources) as ResourceId[]) state.resources[id] = 180;

    const villagers = createStartingVillagers(SEED, 'island-1', [
      { x: 40, y: 20, z: 40 },
      { x: 41, y: 20, z: 40 },
      { x: 42, y: 20, z: 40 },
      { x: 43, y: 20, z: 40 },
    ]);

    const world = JSON.stringify(toSnapshot(state)).length;
    // 60 жителей — потолок §5 ТЗ; считаем по одному и умножаем, чтобы не плодить их вручную.
    const first = villagers[0];
    if (first === undefined) throw new Error('нет жителей');
    const people = JSON.stringify(toVillagerSnapshot(first)).length * 60;

    const kilobytes = (world + people) / 1024;
    expect(kilobytes).toBeLessThan(500);
  });

  it('снимок жителя не тащит наружу путь', () => {
    const villager = createStartingVillagers(SEED, 'island-1', [{ x: 40, y: 20, z: 40 }])[0];
    if (villager === undefined) throw new Error('нет жителя');

    const walking = {
      ...villager,
      path: [
        { x: 1, y: 2, z: 3 },
        { x: 2, y: 2, z: 3 },
      ],
      pathIndex: 1,
    };

    const snapshot = toVillagerSnapshot(walking);
    expect(snapshot.path).toBeUndefined();
    expect(snapshot.pathIndex).toBeUndefined();
    expect(snapshot.name).toBe(villager.name);
  });
});
