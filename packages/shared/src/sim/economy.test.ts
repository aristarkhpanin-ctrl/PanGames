import { beforeEach, describe, expect, it } from 'vitest';

import { BUILDINGS, buildingType } from '../content/buildings';
import type { Command } from '../commands';
import type { ResourceId, Villager } from '../types';
import { Material, voxelIndex, WORLD_X } from '../voxels';
import { generateIsland } from '../worldgen/island';
import { createRng } from '../worldgen/rng';
import { approachCell, chooseAction } from './agents';
import { applyCommand } from './apply';
import { autoAssignments } from './assign';
import {
  ALL_RESOURCES,
  BASE_STORAGE_CAP,
  canAfford,
  comfortAt,
  crewEfficiency,
  homeOf,
  jobOf,
  refundOf,
  storageCap,
} from './economy';
import { WORKER_EFFICIENCY_FLOOR } from './needs';
import { economyTick } from './economyTick';
import { buildNavGrid, isWalkable } from './navigation';
import { simulateTick } from './tick';
import { hourOfTick, TICKS_PER_DAY } from './time';
import { validate } from './validate';
import { createStartingVillagers } from './villager';
import { commitEffect, createWorldState, type WorldReader, type WorldState } from './world';

const SEED = 42;
const island = generateIsland(SEED);
const reader: WorldReader = {
  material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
};
const grid = buildNavGrid(reader);

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
            const height = island.surfaceY[x + dx + WORLD_X * (z + dz)] ?? -1;
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

function villagers(): Villager[] {
  return createStartingVillagers(SEED, 'island-1', [
    { x: 40, y: 40, z: 40 },
    { x: 41, y: 40, z: 40 },
    { x: 42, y: 40, z: 40 },
    { x: 43, y: 40, z: 40 },
  ]);
}

/** Прогоняет команду через проверку и применение, как это делает шина. */
function run(state: WorldState, command: Command, tick = 0): boolean {
  const verdict = validate(command, state, reader);
  if (!verdict.ok) return false;
  commitEffect(state, applyCommand(command, state, reader, tick));
  return true;
}

describe('каталог зданий', () => {
  it('содержит все категории и достаточно записей', () => {
    expect(BUILDINGS.length).toBeGreaterThanOrEqual(32);
    for (const category of ['home', 'gather', 'craft', 'utility', 'culture', 'decor']) {
      expect(BUILDINGS.some((b) => b.category === category)).toBe(true);
    }
  });

  it('цел: требования ссылаются на существующие здания, ресурсы известны', () => {
    const ids = new Set(BUILDINGS.map((b) => b.id));
    const problems: string[] = [];

    for (const building of BUILDINGS) {
      if (building.id.trim() === '' || building.description.trim() === '') {
        problems.push(`${building.id}: пустое имя или описание`);
      }
      for (const required of building.requires) {
        if (!ids.has(required)) problems.push(`${building.id}: требует несуществующее ${required}`);
      }
      if (Object.keys(building.cost).length === 0) problems.push(`${building.id}: бесплатное`);
      if (building.shape.length === 0) problems.push(`${building.id}: без формы`);
      if (building.workers > 0 && building.jobType === undefined) {
        problems.push(`${building.id}: есть рабочие места, но нет вида работы`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('идентификаторы уникальны', () => {
    expect(new Set(BUILDINGS.map((b) => b.id)).size).toBe(BUILDINGS.length);
  });

  it('до каждого здания можно дойти: ни цена, ни требования не замыкаются в круг', () => {
    // Проверка не только по requires, но и по стоимости. Первая версия каталога прошла
    // проверку требований и всё равно была тупиком: лесопилке нужен был камень,
    // каменоломне — доски, а доски делает лесопилка.
    const available = new Set<ResourceId>(['wood', 'fruit', 'fish']);
    const built = new Set<string>();

    let changed = true;
    while (changed) {
      changed = false;
      for (const building of BUILDINGS) {
        if (built.has(building.id)) continue;
        if (!building.requires.every((id) => built.has(id))) continue;
        if (!Object.keys(building.cost).every((id) => available.has(id as ResourceId))) continue;
        if (!Object.keys(building.input ?? {}).every((id) => available.has(id as ResourceId))) {
          continue;
        }

        built.add(building.id);
        for (const id of Object.keys(building.output ?? {})) available.add(id as ResourceId);
        changed = true;
      }
    }

    const unreachable = BUILDINGS.filter((b) => !built.has(b.id)).map((b) => b.id);
    expect(unreachable).toEqual([]);
  });
});

describe('цепочка «лес → лесопилка → доски → дом»', () => {
  let state: WorldState;
  let taken: { x: number; z: number; w: number; d: number }[];

  beforeEach(() => {
    state = createWorldState(SEED);
    taken = [];
  });

  it('работает от начала до конца', () => {
    const crew = villagers();

    // 1. Место дровосека — на него хватает стартового дерева.
    const woodSpot = flatSpot(2, 2, taken);
    const place: Command = { t: 'place_building', typeId: 'woodcutter', pos: woodSpot, rot: 0 };
    expect(validate(place, state, reader)).toEqual({ ok: true });
    expect(run(state, place)).toBe(true);
    expect(state.resources.wood).toBe(12 - 6);

    // 2. Стройка идёт сама и заканчивается — таймеров с наказанием нет.
    for (let tick = 0; tick < 20; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    const woodcutter = state.buildings[0];
    expect(woodcutter?.progress).toBe(1);

    // 3. Ставим человека на работу и добываем дерево.
    const worker = crew[0];
    if (worker === undefined || woodcutter === undefined) throw new Error('нет работника');
    expect(run(state, { t: 'assign_job', villagerId: worker.id, buildingId: woodcutter.id })).toBe(
      true,
    );

    const woodBefore = state.resources.wood;
    for (let tick = 20; tick < 60; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    expect(state.resources.wood).toBeGreaterThan(woodBefore);

    // 4. Лесопилка превращает дерево в доски.
    const millSpot = flatSpot(3, 3, taken);
    expect(run(state, { t: 'place_building', typeId: 'sawmill', pos: millSpot, rot: 0 })).toBe(
      true,
    );

    for (let tick = 60; tick < 90; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    // Здание в состоянии заменяется целиком, поэтому читаем его заново, а не по старой ссылке.
    const mill = state.buildings[1];
    const sawyer = crew[1];
    if (mill === undefined || sawyer === undefined) throw new Error('лесопилка не построилась');
    expect(mill.progress).toBe(1);
    expect(run(state, { t: 'assign_job', villagerId: sawyer.id, buildingId: mill.id })).toBe(true);

    for (let tick = 90; tick < 220; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    expect(state.resources.plank).toBeGreaterThan(0);

    // 5. Домик становится доступен, как только досок хватает.
    const cottage = buildingType('cottage');
    if (cottage === undefined) throw new Error('нет домика в каталоге');
    state.resources.plank = Math.max(state.resources.plank, cottage.cost.plank ?? 0);
    state.resources.stone = cottage.cost.stone ?? 0;

    const homeSpot = flatSpot(3, 3, taken);
    expect(run(state, { t: 'place_building', typeId: 'cottage', pos: homeSpot, rot: 0 })).toBe(
      true,
    );
  });
});

describe('правила застройки', () => {
  let state: WorldState;
  let taken: { x: number; z: number; w: number; d: number }[];

  beforeEach(() => {
    state = createWorldState(SEED);
    taken = [];
  });

  it('без ресурсов не строит', () => {
    state.resources.wood = 0;
    const spot = flatSpot(2, 2, taken);
    expect(
      validate({ t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 }, state, reader),
    ).toEqual({ ok: false, reason: 'cannot_afford' });
  });

  it('не ставит два здания на одно место', () => {
    const spot = flatSpot(2, 2, taken);
    run(state, { t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 });
    state.resources.wood = 100;
    expect(
      validate({ t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 }, state, reader),
    ).toEqual({ ok: false, reason: 'occupied' });
  });

  it('не ставит дом в воду, а пирс — на сушу', () => {
    let waterX = -1;
    let waterZ = -1;
    for (let i = 0; i < island.shape.land.length && waterX === -1; i += 1) {
      if (island.shape.land[i] === 0 && island.shape.openSea[i] === 1) {
        waterX = i % WORLD_X;
        waterZ = (i - waterX) / WORLD_X;
      }
    }
    state.resources.wood = 100;
    state.resources.plank = 100;

    expect(
      validate(
        { t: 'place_building', typeId: 'woodcutter', pos: { x: waterX, y: 0, z: waterZ }, rot: 0 },
        state,
        reader,
      ),
    ).toEqual({ ok: false, reason: 'needs_land' });

    const land = flatSpot(2, 4, taken);
    expect(
      validate({ t: 'place_building', typeId: 'pier', pos: land, rot: 0 }, state, reader),
    ).toEqual({ ok: false, reason: 'needs_water' });
  });

  it('не строит то, для чего нет предшественника', () => {
    state.resources.plank = 100;
    state.resources.stone = 100;
    const spot = flatSpot(3, 3, taken);
    expect(
      validate({ t: 'place_building', typeId: 'cottage', pos: spot, rot: 0 }, state, reader),
    ).toEqual({ ok: false, reason: 'requires_missing' });
  });

  it('перемещение бесплатно и всегда', () => {
    // Устав, п. 6: за «передумать» платить не приходится.
    const spot = flatSpot(2, 2, taken);
    run(state, { t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 });
    const id = state.buildings[0]?.id ?? '';

    state.resources.wood = 0;
    const target = flatSpot(2, 2, taken);
    expect(run(state, { t: 'move_building', id, pos: target, rot: 0 })).toBe(true);
    expect(state.resources.wood).toBe(0);
    expect(state.buildings[0]?.x).toBe(target.x);
  });

  it('отмена заказа возвращает всё, поздний снос — семьдесят процентов', () => {
    const type = buildingType('woodcutter');
    if (type === undefined) throw new Error('нет здания');

    const unfinished = {
      id: 'b',
      typeId: 'woodcutter',
      x: 0,
      y: 0,
      z: 0,
      rotation: 0 as const,
      level: 1 as const,
      workers: [],
      residents: [],
      progress: 0.4,
    };
    expect(refundOf(unfinished, type.cost, 500)).toEqual({ wood: 6 });

    const fresh = { ...unfinished, progress: 1, builtAtTick: 480 };
    expect(refundOf(fresh, type.cost, 500)).toEqual({ wood: 6 });

    const old = { ...unfinished, progress: 1, builtAtTick: 10 };
    expect(refundOf(old, type.cost, 500)).toEqual({ wood: 4 });
  });
});

describe('производство и склад', () => {
  it('эффективность смены никогда не ниже пола устава', () => {
    const type = buildingType('woodcutter');
    if (type === undefined) throw new Error('нет здания');

    const sad = villagers().map((villager) => ({ ...villager, mood: 20 }));
    expect(crewEfficiency([sad[0] as Villager], type)).toBeGreaterThanOrEqual(
      WORKER_EFFICIENCY_FLOOR,
    );
  });

  it('амбар увеличивает вместимость склада', () => {
    const granary = {
      id: 'g',
      typeId: 'granary',
      x: 0,
      y: 0,
      z: 0,
      rotation: 0 as const,
      level: 1 as const,
      workers: [],
      residents: [],
      progress: 1,
    };
    expect(storageCap([])).toBe(BASE_STORAGE_CAP);
    expect(storageCap([granary])).toBe(BASE_STORAGE_CAP + 150);
    // Недостроенный амбар пока ничего не добавляет.
    expect(storageCap([{ ...granary, progress: 0.5 }])).toBe(BASE_STORAGE_CAP);
  });

  it('полный склад останавливает производство, но ничего не теряет', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const spot = flatSpot(2, 2, taken);
    run(state, { t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 });

    const crew = villagers();
    for (let tick = 0; tick < 20; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    const building = state.buildings[0];
    const worker = crew[0];
    if (building === undefined || worker === undefined) throw new Error('нет здания');
    run(state, { t: 'assign_job', villagerId: worker.id, buildingId: building.id });

    state.resources.wood = state.storageCap;
    commitEffect(
      state,
      economyTick(state, { villagers: crew, hour: 12, tick: 30, nodes: island.resourceNodes }),
    );

    expect(state.resources.wood).toBe(state.storageCap);
    expect(state.buildings[0]?.pausedReason).toBe('storage_full');
  });

  it('ночью добыча идёт медленнее, а не останавливается совсем', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const spot = flatSpot(2, 2, taken);
    run(state, { t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 });

    const crew = villagers();
    for (let tick = 0; tick < 20; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    const building = state.buildings[0];
    const worker = crew[0];
    if (building === undefined || worker === undefined) throw new Error('нет здания');
    run(state, { t: 'assign_job', villagerId: worker.id, buildingId: building.id });

    const day = economyTick(state, {
      villagers: crew,
      hour: 12,
      tick: 30,
      nodes: island.resourceNodes,
    });
    const night = economyTick(state, {
      villagers: crew,
      hour: 2,
      tick: 30,
      nodes: island.resourceNodes,
    });

    expect(night.resources.wood ?? 0).toBeGreaterThan(0);
    expect(night.resources.wood ?? 0).toBeLessThan(day.resources.wood ?? 0);
  });

  it('ресурсы никогда не уходят в минус', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const spot = flatSpot(3, 3, taken);

    state.resources.wood = 100;
    state.resources.stone = 100;
    run(state, { t: 'place_building', typeId: 'sawmill', pos: spot, rot: 0 });

    const crew = villagers();
    for (let tick = 0; tick < 400; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
      for (const value of Object.values(state.resources)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('нехватка сырья тихо ставит здание на паузу', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const spot = flatSpot(3, 3, taken);
    state.resources.wood = 100;
    state.resources.stone = 100;
    run(state, { t: 'place_building', typeId: 'sawmill', pos: spot, rot: 0 });

    const crew = villagers();
    for (let tick = 0; tick < 30; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    const mill = state.buildings[0];
    const worker = crew[0];
    if (mill === undefined || worker === undefined) throw new Error('нет лесопилки');
    run(state, { t: 'assign_job', villagerId: worker.id, buildingId: mill.id });

    state.resources.wood = 0;
    commitEffect(
      state,
      economyTick(state, { villagers: crew, hour: 12, tick: 40, nodes: island.resourceNodes }),
    );
    expect(state.buildings[0]?.pausedReason).toBe('no_input');
  });

  it('хватает ли на постройку — считается честно', () => {
    expect(canAfford({ wood: 5 } as Record<ResourceId, number>, { wood: 4 })).toBe(true);
    expect(canAfford({ wood: 3 } as Record<ResourceId, number>, { wood: 4 })).toBe(false);
  });
});

describe('дом, работа и жители', () => {
  /** Строит здание разом: тесту про жильё неинтересно, сколько тиков шла стройка. */
  function buildNow(
    state: WorldState,
    typeId: string,
    taken: { x: number; z: number; w: number; d: number }[],
  ): string {
    const type = buildingType(typeId);
    if (type === undefined) throw new Error(`нет здания ${typeId}`);

    for (const [id, amount] of Object.entries(type.cost) as [ResourceId, number][]) {
      state.resources[id] = Math.max(state.resources[id], amount);
    }
    for (const required of type.requires) {
      if (!state.buildings.some((b) => b.typeId === required)) buildNow(state, required, taken);
    }

    const spot = flatSpot(type.footprint.w, type.footprint.d, taken);
    if (!run(state, { t: 'place_building', typeId, pos: spot, rot: 0 })) {
      throw new Error(`не встало здание ${typeId}`);
    }

    const placed = state.buildings[state.buildings.length - 1];
    if (placed === undefined) throw new Error('здание не появилось');
    commitEffect(state, {
      voxels: [],
      plantsAdded: [],
      plantsRemoved: [],
      buildings: [
        { id: placed.id, before: placed, after: { ...placed, progress: 1, builtAtTick: 0 } },
      ],
      resources: {},
      nodes: [],
    });
    return placed.id;
  }

  it('житель получает дом, и нужда «укрытие» закрывается', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const hut = buildNow(state, 'hut', taken);
    const crew = villagers();
    const first = crew[0];
    if (first === undefined) throw new Error('нет жителя');

    expect(run(state, { t: 'assign_home', villagerId: first.id, buildingId: hut })).toBe(true);
    expect(homeOf(state.buildings, first.id)?.id).toBe(hut);

    const before = { ...first, needs: { ...first.needs, shelter: 0 } };
    const after = simulateTick(
      { tick: 0, villagers: [before] },
      { grid, scenicSpots: [], seed: SEED, buildings: state.buildings },
    );
    expect(after.state.villagers[0]?.needs.shelter).toBe(100);
    expect(after.state.villagers[0]?.homeId).toBe(hut);
  });

  it('в шалаш на одну кровать второго не селят', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const hut = buildNow(state, 'hut', taken);
    const crew = villagers();
    const [first, second] = crew;
    if (first === undefined || second === undefined) throw new Error('нет жителей');

    expect(run(state, { t: 'assign_home', villagerId: first.id, buildingId: hut })).toBe(true);
    expect(
      validate({ t: 'assign_home', villagerId: second.id, buildingId: hut }, state, reader),
    ).toEqual({ ok: false, reason: 'home_full' });
  });

  it('спать житель идёт домой', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const hut = buildNow(state, 'hut', taken);
    const home = state.buildings.find((building) => building.id === hut);
    const first = villagers()[0];
    if (home === undefined || first === undefined) throw new Error('нет дома');

    run(state, { t: 'assign_home', villagerId: first.id, buildingId: hut });

    const target = approachCell(home, grid);
    expect(target).not.toBeNull();
    // Ночью и с пустым отдыхом сон выигрывает у всего остального.
    const sleepy = {
      ...first,
      needs: { ...first.needs, rest: 0 },
      position: { x: 40, y: 40, z: 40 },
    };
    const context = {
      grid,
      hour: 23,
      tick: 1,
      villagers: [sleepy],
      scenicSpots: [],
      buildings: state.buildings,
    };
    const chosen = chooseAction(sleepy, context, createRng(1));
    expect(chosen.state).toBe('sleep');
    expect(chosen.target).toEqual(target);
  });

  it('автоназначение заселяет и раздаёт работу, но не переселяет уже устроенных', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    buildNow(state, 'hut', taken);
    buildNow(state, 'hut', taken);
    buildNow(state, 'woodcutter', taken);
    const crew = villagers();

    for (const command of autoAssignments(state, crew)) run(state, command);

    const housed = crew.filter((villager) => homeOf(state.buildings, villager.id) !== undefined);
    expect(housed).toHaveLength(2);
    expect(state.buildings.find((b) => b.typeId === 'woodcutter')?.workers).toHaveLength(1);

    // Повторный заход ничего не меняет: свободных мест больше нет.
    const before = JSON.stringify(state.buildings);
    for (const command of autoAssignments(state, crew)) run(state, command);
    expect(JSON.stringify(state.buildings)).toBe(before);
  });

  it('снятого с работы вручную автоназначение не трогает', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    buildNow(state, 'woodcutter', taken);
    const crew = villagers();
    const first = crew[0];
    if (first === undefined) throw new Error('нет жителя');

    const detached = new Set([first.id]);
    for (const command of autoAssignments(state, crew, { detached })) run(state, command);
    expect(jobOf(state.buildings, first.id)).toBeUndefined();
  });
});

describe('залежи', () => {
  it('добытое уходит из залежи, а не берётся из воздуха', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const spot = flatSpot(2, 2, taken);
    run(state, { t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 });

    const crew = villagers();
    for (let tick = 0; tick < 30; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    const woodcutter = state.buildings[0];
    const worker = crew[0];
    if (woodcutter === undefined || worker === undefined) throw new Error('нет дровосека');
    run(state, { t: 'assign_job', villagerId: worker.id, buildingId: woodcutter.id });

    const woodBefore = state.resources.wood;
    const effect = economyTick(state, {
      villagers: crew,
      hour: 12,
      tick: 40,
      nodes: island.resourceNodes,
    });
    commitEffect(state, effect);

    const gained = state.resources.wood - woodBefore;
    expect(gained).toBeGreaterThan(0);

    // Отрастание за тот же тик добавляет обратно, поэтому сравниваем с полной суммой запасов.
    const totalBefore = island.resourceNodes
      .filter((node) => node.kind === 'wood')
      .reduce((sum, node) => sum + node.amount, 0);
    const totalAfter = island.resourceNodes
      .filter((node) => node.kind === 'wood')
      .reduce((sum, node) => sum + (state.nodes.get(node.id) ?? node.amount), 0);
    expect(totalAfter).toBeLessThan(totalBefore + gained);
  });

  it('отрастание не поднимает запас выше исходного', () => {
    const state = createWorldState(SEED);
    const berry = island.resourceNodes.find((node) => node.kind === 'berry');
    if (berry === undefined) throw new Error('нет ягодника');

    state.nodes.set(berry.id, berry.capacity - 1);
    for (let tick = 0; tick < TICKS_PER_DAY * 3; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: [], hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    expect(state.nodes.get(berry.id)).toBe(berry.capacity);
  });

  it('камень конечен, но его хватает на несколько полных застроек', () => {
    const stone = island.resourceNodes
      .filter((node) => node.kind === 'stone')
      .reduce((sum, node) => sum + node.capacity, 0);
    const everything = BUILDINGS.reduce((sum, type) => sum + (type.cost.stone ?? 0), 0);
    expect(stone).toBeGreaterThan(everything * 4);
  });

  it('выработанная залежь тихо ставит здание на паузу, а не ломает игру', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const spot = flatSpot(2, 2, taken);
    run(state, { t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 });

    const crew = villagers();
    for (let tick = 0; tick < 30; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    const woodcutter = state.buildings[0];
    const worker = crew[0];
    if (woodcutter === undefined || worker === undefined) throw new Error('нет дровосека');
    run(state, { t: 'assign_job', villagerId: worker.id, buildingId: woodcutter.id });

    for (const node of island.resourceNodes) {
      if (node.kind === 'wood') state.nodes.set(node.id, 0);
    }
    const woodBefore = state.resources.wood;
    commitEffect(
      state,
      economyTick(state, { villagers: crew, hour: 12, tick: 40, nodes: island.resourceNodes }),
    );

    expect(state.buildings[0]?.pausedReason).toBe('no_source');
    expect(state.resources.wood).toBe(woodBefore);
  });
});

describe('уют', () => {
  it('складывается из того, что стоит и растёт рядом, и никогда не отрицателен', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const spot = flatSpot(2, 2, taken);
    run(state, { t: 'place_building', typeId: 'hut', pos: spot, rot: 0 });
    const hut = state.buildings[0];
    if (hut === undefined) throw new Error('нет шалаша');

    // Недостроенное не считается: уют появляется вместе со зданием.
    expect(comfortAt(spot, state.buildings, [])).toBe(0);

    const ready = [{ ...hut, progress: 1 }];
    expect(comfortAt(spot, ready, [])).toBeGreaterThan(0);
    expect(comfortAt({ x: spot.x + 40, z: spot.z + 40 }, ready, [])).toBe(0);
    expect(comfortAt(spot, ready, [{ x: spot.x, z: spot.z }])).toBeGreaterThan(
      comfortAt(spot, ready, []),
    );
  });

  it('обустроенное место медленнее теряет красоту', () => {
    const first = villagers()[0];
    if (first === undefined) throw new Error('нет жителя');

    const at = { x: 60, y: 40, z: 60 };
    const villager = { ...first, position: at, needs: { ...first.needs, beauty: 40 } };
    const cosy = Array.from({ length: 4 }, (_, index) => ({
      id: `c${String(index)}`,
      typeId: 'hut',
      x: at.x + index,
      y: at.y,
      z: at.z,
      rotation: 0 as const,
      level: 1 as const,
      workers: [],
      residents: [],
      progress: 1,
    }));

    const plain = simulateTick(
      { tick: 0, villagers: [villager] },
      { grid, scenicSpots: [], seed: SEED },
    );
    const nice = simulateTick(
      { tick: 0, villagers: [villager] },
      { grid, scenicSpots: [], seed: SEED, buildings: cosy },
    );

    expect(nice.state.villagers[0]?.needs.beauty ?? 0).toBeGreaterThan(
      plain.state.villagers[0]?.needs.beauty ?? 0,
    );
  });
});

describe('пять игровых дней', () => {
  it('цепочка «лес → доски» выдаёт правдоподобные числа, а баланс не взрывается', () => {
    const state = createWorldState(SEED);
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const crew = villagers();

    const woodSpot = flatSpot(2, 2, taken);
    run(state, { t: 'place_building', typeId: 'woodcutter', pos: woodSpot, rot: 0 });
    for (let tick = 0; tick < 20; tick += 1) {
      commitEffect(
        state,
        economyTick(state, { villagers: crew, hour: 12, tick, nodes: island.resourceNodes }),
      );
    }
    const woodcutter = state.buildings[0];
    const worker = crew[0];
    if (woodcutter === undefined || worker === undefined) throw new Error('нет дровосека');
    run(state, { t: 'assign_job', villagerId: worker.id, buildingId: woodcutter.id });

    const days = 5;
    for (let tick = 0; tick < TICKS_PER_DAY * days; tick += 1) {
      commitEffect(
        state,
        economyTick(state, {
          villagers: crew,
          hour: hourOfTick(tick),
          tick,
          nodes: island.resourceNodes,
        }),
      );
    }

    // Один дровосек за пять дней набирает заметный, но не бесконечный запас.
    expect(state.resources.wood).toBeGreaterThan(20);
    expect(state.resources.wood).toBeLessThanOrEqual(state.storageCap);

    for (const id of ALL_RESOURCES) {
      expect(state.resources[id]).toBeGreaterThanOrEqual(0);
      expect(state.resources[id]).toBeLessThanOrEqual(state.storageCap);
    }
  });
});
