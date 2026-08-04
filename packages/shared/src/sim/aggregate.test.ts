import { describe, expect, it } from 'vitest';

import { BUILDINGS, buildingType } from '../content/buildings';
import type { ResourceId, Villager } from '../types';
import { Material, voxelIndex, WORLD_Y } from '../voxels';
import { generateIsland } from '../worldgen/island';
import {
  catchUp,
  CAP_HOURS,
  creditedGameHours,
  FULL_SPEED_HOURS,
  GAME_HOURS_PER_REAL_HOUR,
  OFFLINE_MOOD,
  SLOW_FACTOR,
} from './aggregate';
import { applyCommand } from './apply';
import { economyTick } from './economyTick';
import { buildNavGrid, isWalkable } from './navigation';
import { MOOD_OFFLINE_FLOOR } from './needs';
import { hourOfTick, TICKS_PER_HOUR } from './time';
import { createStartingVillagers } from './villager';
import {
  commitEffect,
  createWorldState,
  surfaceHeight,
  type WorldReader,
  type WorldState,
} from './world';
import { validate } from './validate';

/**
 * Проверки сводной симуляции (§3 ТЗ).
 *
 * Главное здесь — не точность до единицы, а два свойства: она не расходится с живой
 * симуляцией настолько, чтобы игрок это заметил, и она никогда не наказывает за отсутствие.
 */

const SEED = 42;
const HOUR_MS = 3_600_000;

const island = generateIsland(SEED);
const reader: WorldReader = {
  material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
};
const grid = buildNavGrid(reader);

function villagers(): Villager[] {
  return createStartingVillagers(SEED, 'island-1', [
    { x: 40, y: 40, z: 40 },
    { x: 41, y: 40, z: 40 },
    { x: 42, y: 40, z: 40 },
    { x: 43, y: 40, z: 40 },
  ]);
}

/** Ровная площадка нужного размера — здания не ставятся на склон. */
function flatSpot(w: number, d: number, taken: { x: number; z: number; w: number; d: number }[]) {
  for (let z = 15; z < 140; z += 1) {
    for (let x = 15; x < 140; x += 1) {
      let ok = true;
      let base = -1;

      for (let dz = 0; dz < d && ok; dz += 1) {
        for (let dx = 0; dx < w && ok; dx += 1) {
          if (!isWalkable(grid, x + dx, z + dz)) ok = false;
          else {
            const height = surfaceHeight(reader, x + dx, z + dz, WORLD_Y - 1);
            if (base === -1) base = height;
            else if (height !== base) ok = false;
          }
        }
      }

      if (!ok) continue;
      if (taken.some((t) => x < t.x + t.w && t.x < x + w && z < t.z + t.d && t.z < z + d)) continue;

      taken.push({ x, z, w, d });
      return { x, y: base + 1, z };
    }
  }
  throw new Error(`не нашлось ровной площадки ${String(w)}×${String(d)}`);
}

function run(state: WorldState, command: Parameters<typeof validate>[0], tick = 0): void {
  const verdict = validate(command, state, reader);
  if (!verdict.ok) throw new Error(`команда отклонена: ${verdict.reason}`);
  commitEffect(state, applyCommand(command, state, reader, tick));
}

/** Остров с готовым местом дровосека и работником на нём. */
function workingIsland(): { world: WorldState; crew: Villager[] } {
  const world = createWorldState(SEED);
  const crew = villagers();
  const taken: { x: number; z: number; w: number; d: number }[] = [];

  const spot = flatSpot(2, 2, taken);
  run(world, { t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 });

  const building = world.buildings[0];
  if (building === undefined) throw new Error('здание не встало');
  commitEffect(world, {
    voxels: [],
    plantsAdded: [],
    plantsRemoved: [],
    buildings: [
      { id: building.id, before: building, after: { ...building, progress: 1, builtAtTick: 0 } },
    ],
    resources: {},
    nodes: [],
  });

  const worker = crew[0];
  if (worker === undefined) throw new Error('нет работника');
  run(world, { t: 'assign_job', villagerId: worker.id, buildingId: building.id });

  return { world, crew };
}

describe('коэффициенты догона', () => {
  it('первые двенадцать часов идут в полную силу', () => {
    expect(creditedGameHours(HOUR_MS)).toBeCloseTo(GAME_HOURS_PER_REAL_HOUR, 5);
    expect(creditedGameHours(11.98 * HOUR_MS)).toBeCloseTo(11.98 * GAME_HOURS_PER_REAL_HOUR, 3);
  });

  it('после двенадцатого часа включается коэффициент', () => {
    const twelve = creditedGameHours(FULL_SPEED_HOURS * HOUR_MS);
    const later = creditedGameHours((FULL_SPEED_HOURS + 1) * HOUR_MS);
    expect(later - twelve).toBeCloseTo(SLOW_FACTOR * GAME_HOURS_PER_REAL_HOUR, 3);
  });

  it('на сорок восьмом часе накопление останавливается', () => {
    const capped = creditedGameHours(CAP_HOURS * HOUR_MS);
    expect(creditedGameHours((CAP_HOURS + 0.02) * HOUR_MS)).toBeCloseTo(capped, 5);
    expect(creditedGameHours(200 * HOUR_MS)).toBeCloseTo(capped, 5);
  });

  it('заход сразу после выхода догона не даёт', () => {
    expect(creditedGameHours(0)).toBe(0);
    expect(creditedGameHours(-5000)).toBe(0);
  });
});

describe('сводная симуляция', () => {
  it('не расходится с живой больше чем на пятнадцать процентов за двенадцать игровых часов', () => {
    const live = workingIsland();
    const aggregate = workingIsland();

    // Живая: двенадцать игровых часов по тикам, как при живом игроке.
    const ticks = 12 * TICKS_PER_HOUR;
    for (let tick = 0; tick < ticks; tick += 1) {
      commitEffect(
        live.world,
        economyTick(live.world, {
          villagers: live.crew,
          hour: hourOfTick(tick),
          tick,
          nodes: island.resourceNodes,
        }),
      );
    }

    // Сводная: те же двенадцать игровых часов одним куском.
    const result = catchUp({
      world: aggregate.world,
      villagers: aggregate.crew,
      nodes: island.resourceNodes,
      reader,
      fromTick: 0,
      absenceMs: (12 / GAME_HOURS_PER_REAL_HOUR) * HOUR_MS,
    });

    for (const id of ['wood'] as ResourceId[]) {
      const fromLive = live.world.resources[id];
      const fromAggregate = result.world.resources[id];
      const difference = Math.abs(fromAggregate - fromLive) / Math.max(1, fromLive);

      expect(fromLive).toBeGreaterThan(0);
      expect(difference).toBeLessThanOrEqual(0.15);
    }
  });

  it('ни один ресурс не уходит в минус и не превышает вместимость', () => {
    const { world, crew } = workingIsland();

    const result = catchUp({
      world,
      villagers: crew,
      nodes: island.resourceNodes,
      reader,
      fromTick: 0,
      absenceMs: 30 * HOUR_MS,
    });

    for (const [, amount] of Object.entries(result.world.resources)) {
      expect(amount).toBeGreaterThanOrEqual(0);
      expect(amount).toBeLessThanOrEqual(result.world.storageCap);
    }
  });

  it('стройка, начатая перед выходом, закончена к возвращению', () => {
    const world = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const spot = flatSpot(2, 2, taken);
    run(world, { t: 'place_building', typeId: 'hut', pos: spot, rot: 0 });
    expect(world.buildings[0]?.progress).toBe(0);

    const result = catchUp({
      world,
      villagers: villagers(),
      nodes: island.resourceNodes,
      reader,
      fromTick: 0,
      absenceMs: HOUR_MS,
    });

    expect(result.world.buildings[0]?.progress).toBe(1);
    expect(result.events.some((event) => event.kind === 'built')).toBe(true);
  });

  it('достроенный дом кто-то занимает', () => {
    const world = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    run(world, { t: 'place_building', typeId: 'hut', pos: flatSpot(2, 2, taken), rot: 0 });

    const result = catchUp({
      world,
      villagers: villagers(),
      nodes: island.resourceNodes,
      reader,
      fromTick: 0,
      absenceMs: HOUR_MS,
    });

    const settled = result.events.find((event) => event.kind === 'settled');
    expect(settled).toBeDefined();
    expect(result.world.buildings[0]?.residents).toHaveLength(1);
  });

  it('настроение сходится к спокойному и не падает ниже пола устава', () => {
    const sad = villagers().map((villager) => ({ ...villager, mood: MOOD_OFFLINE_FLOOR }));
    const glad = villagers().map((villager) => ({ ...villager, mood: 100 }));

    for (const crew of [sad, glad]) {
      const result = catchUp({
        world: createWorldState(SEED),
        villagers: crew,
        nodes: island.resourceNodes,
        reader,
        fromTick: 0,
        absenceMs: 20 * HOUR_MS,
      });

      for (const villager of result.villagers) {
        expect(villager.mood).toBeGreaterThanOrEqual(MOOD_OFFLINE_FLOOR);
        expect(villager.mood).toBeLessThanOrEqual(100);
        expect(Math.abs(villager.mood - OFFLINE_MOOD)).toBeLessThan(1);
      }
    }
  });

  it('за отсутствие ничего не отнимается', () => {
    const world = createWorldState(SEED);
    world.resources.wood = 120;
    world.resources.plank = 30;

    const result = catchUp({
      world,
      villagers: villagers(),
      nodes: island.resourceNodes,
      reader,
      fromTick: 0,
      absenceMs: 100 * HOUR_MS,
    });

    expect(result.world.resources.wood).toBeGreaterThanOrEqual(120);
    expect(result.world.resources.plank).toBeGreaterThanOrEqual(30);
  });

  it('исходное состояние не меняется: функция чистая', () => {
    const { world, crew } = workingIsland();
    const before = JSON.stringify({
      resources: world.resources,
      buildings: world.buildings,
      moods: crew.map((villager) => villager.mood),
    });

    catchUp({
      world,
      villagers: crew,
      nodes: island.resourceNodes,
      reader,
      fromTick: 0,
      absenceMs: 24 * HOUR_MS,
    });

    expect(
      JSON.stringify({
        resources: world.resources,
        buildings: world.buildings,
        moods: crew.map((villager) => villager.mood),
      }),
    ).toBe(before);
  });

  it('догон на двести часов не медленнее догона на сорок восемь', () => {
    const measure = (hours: number): number => {
      const { world, crew } = workingIsland();
      const started = Date.now();
      catchUp({
        world,
        villagers: crew,
        nodes: island.resourceNodes,
        reader,
        fromTick: 0,
        absenceMs: hours * HOUR_MS,
      });
      return Date.now() - started;
    };

    const short = measure(CAP_HOURS);
    const long = measure(200);

    // Потолок обязан ограничивать работу, а не только результат.
    expect(long).toBeLessThanOrEqual(short + 30);
  });

  it('догон на сутки считается за миллисекунды', () => {
    const { world, crew } = workingIsland();

    const started = Date.now();
    catchUp({
      world,
      villagers: crew,
      nodes: island.resourceNodes,
      reader,
      fromTick: 0,
      absenceMs: 24 * HOUR_MS,
    });

    expect(Date.now() - started).toBeLessThan(200);
  });

  it('полный остров считается так же быстро', () => {
    const world = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];

    // Двести пятьдесят зданий — потолок §12 ТЗ.
    const type = buildingType('hut');
    if (type === undefined) throw new Error('нет шалаша');
    for (let i = 0; i < 250; i += 1) {
      world.buildings.push({
        id: `building-${String(i + 1)}`,
        typeId: BUILDINGS[i % BUILDINGS.length]?.id ?? 'hut',
        x: 20 + (i % 40),
        y: 20,
        z: 20 + Math.floor(i / 40),
        rotation: 0,
        level: 1,
        workers: [],
        residents: [],
        progress: 1,
        builtAtTick: 0,
      });
    }
    void taken;

    const started = Date.now();
    catchUp({
      world,
      villagers: villagers(),
      nodes: island.resourceNodes,
      reader,
      fromTick: 0,
      absenceMs: CAP_HOURS * HOUR_MS,
    });

    expect(Date.now() - started).toBeLessThan(500);
  });
});
