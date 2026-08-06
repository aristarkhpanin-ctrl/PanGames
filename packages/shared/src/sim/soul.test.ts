import { describe, expect, it } from 'vitest';

import { BUILDINGS } from '../content/buildings';
import {
  CHAPTERS,
  chapterInfo,
  countFriendships,
  earnedChapter,
  nextChapter,
} from '../content/chapters';
import type { PlacedBuilding } from './economy';
import type { Villager } from '../types';
import { Material, voxelIndex } from '../voxels';
import { generateIsland } from '../worldgen/island';
import { applyCommand } from './apply';
import { FESTIVAL_COST, FESTIVAL_INSPIRATION } from './festival';
import { buildNavGrid } from './navigation';
import { findScenicSpots } from './places';
import { bondLevel, bondWord, chooseFavoriteSpot, friendsOf, growBonds, isKeeper } from './social';
import { simulateTick } from './tick';
import { createStartingVillagers } from './villager';
import { commitEffect, createWorldState, type WorldReader } from './world';
import { validate } from './validate';
import { activeWishes, describeWish, wishFulfilled, WISHES_PER_ISLAND } from './wishes';

/**
 * Проверки того, ради чего игра существует (§5, §7 ТЗ): дружба, любимые места, желания,
 * праздники и главы. Здесь же проверяется, что ни одна из этих механик не превратилась
 * в задание с напоминанием.
 */

const SEED = 42;
const island = generateIsland(SEED);
const reader: WorldReader = {
  material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
};
const grid = buildNavGrid(reader);
const scenicSpots = findScenicSpots(grid);

function villagers(count = 4): Villager[] {
  return createStartingVillagers(
    SEED,
    'island-1',
    Array.from({ length: count }, (_, i) => ({ x: 40 + i, y: 40, z: 40 })),
  ).slice(0, count);
}

function building(id: string, typeId: string, x: number, z: number): PlacedBuilding {
  return {
    id,
    typeId,
    x,
    y: 20,
    z,
    rotation: 0,
    level: 1,
    workers: [],
    residents: [],
    progress: 1,
    builtAtTick: 0,
  };
}

describe('отношения', () => {
  it('копятся, пока люди разговаривают рядом, и растут только вверх', () => {
    const crew = villagers(2).map((villager) => ({
      ...villager,
      state: 'socialize' as const,
      position: { x: 50, y: 20, z: 50 },
    }));

    let level = 0;
    for (let tick = 0; tick < 300; tick += 1) {
      for (const risen of growBonds(crew)) level = Math.max(level, risen.level);
    }

    expect(level).toBeGreaterThanOrEqual(2);
    // Связь взаимна: односторонней дружбы игра не показывает.
    expect(crew[0]?.bonds[0]?.withId).toBe(crew[1]?.id);
    expect(crew[1]?.bonds[0]?.withId).toBe(crew[0]?.id);
    expect(crew[0]?.bonds[0]?.points).toBe(crew[1]?.bonds[0]?.points);
  });

  it('не копятся у тех, кто далеко или занят другим', () => {
    const far = villagers(2).map((villager, index) => ({
      ...villager,
      state: 'socialize' as const,
      position: { x: 40 + index * 40, y: 20, z: 40 },
    }));
    const busy = villagers(2).map((villager) => ({
      ...villager,
      state: 'work' as const,
      position: { x: 50, y: 20, z: 50 },
    }));

    for (let tick = 0; tick < 50; tick += 1) {
      growBonds(far);
      growBonds(busy);
    }

    expect(far[0]?.bonds).toHaveLength(0);
    expect(busy[0]?.bonds).toHaveLength(0);
  });

  it('называются словом, а не числом', () => {
    expect(bondWord(bondLevel(0))).toBe('знакомы');
    expect(bondWord(bondLevel(5000))).toBe('близкие');
  });

  it('друзьями считаются с третьего уровня', () => {
    const crew = villagers(2);
    const [first, second] = crew;
    if (first === undefined || second === undefined) throw new Error('нет жителей');

    first.bonds.push({ withId: second.id, level: 1, points: 200 });
    expect(friendsOf(first, crew)).toHaveLength(0);

    first.bonds[0] = { withId: second.id, level: 2, points: 500 };
    expect(friendsOf(first, crew)).toHaveLength(1);
  });
});

describe('любимое место', () => {
  it('появляется не сразу, а через пару дней жизни', () => {
    const villager = villagers(1)[0];
    if (villager === undefined) throw new Error('нет жителя');
    villager.arrivedAtTick = 0;

    expect(chooseFavoriteSpot(villager, grid, scenicSpots, 100)).toBeNull();
    expect(chooseFavoriteSpot(villager, grid, scenicSpots, 400)).not.toBeNull();
  });

  it('выбирается один раз и не меняется', () => {
    const villager = villagers(1)[0];
    if (villager === undefined) throw new Error('нет жителя');
    villager.arrivedAtTick = 0;

    const spot = chooseFavoriteSpot(villager, grid, scenicSpots, 400);
    if (spot === null) throw new Error('место не выбралось');
    villager.favoriteSpot = spot;

    expect(chooseFavoriteSpot(villager, grid, scenicSpots, 800)).toBeNull();
  });

  it('у разных жителей разное', () => {
    const crew = villagers(4).map((villager) => ({ ...villager, arrivedAtTick: 0 }));
    const spots = crew.map((villager) => chooseFavoriteSpot(villager, grid, scenicSpots, 500));
    const distinct = new Set(spots.map((spot) => `${String(spot?.x)}:${String(spot?.z)}`));

    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('возраст', () => {
  it('делает жителя хранителем историй, но никого не забирает', () => {
    const villager = villagers(1)[0];
    if (villager === undefined) throw new Error('нет жителя');
    villager.arrivedAtTick = 0;

    expect(isKeeper(villager, 144 * 10)).toBe(false);
    expect(isKeeper(villager, 144 * 50)).toBe(true);
    // Старость в этой игре — про уважение, а не про убыль: житель остаётся жителем.
    expect(villager.mood).toBeGreaterThan(0);
  });
});

describe('желания', () => {
  it('просят скамейку на любимое место — и замолкают, когда она есть', () => {
    const villager = villagers(1)[0];
    if (villager === undefined) throw new Error('нет жителя');
    villager.favoriteSpot = { x: 60, y: 20, z: 60 };

    const context = { villagers: [villager], buildings: [], plants: [], tick: 10 };
    expect(describeWish(villager, context)?.kind).toBe('bench_at_favorite_spot');

    const withBench = { ...context, buildings: [building('b1', 'bench', 61, 60)] };
    expect(describeWish(villager, withBench)?.kind).not.toBe('bench_at_favorite_spot');
  });

  it('считаются исполненными, когда игрок поставил то, о чём думали', () => {
    const villager = villagers(1)[0];
    if (villager === undefined) throw new Error('нет жителя');
    villager.favoriteSpot = { x: 60, y: 20, z: 60 };
    villager.wish = { kind: 'bench_at_favorite_spot', createdAt: 1 };

    const before = { villagers: [villager], buildings: [], plants: [], tick: 20 };
    expect(wishFulfilled(villager, before)).toBe(false);

    const after = { ...before, buildings: [building('b1', 'bench', 60, 61)] };
    expect(wishFulfilled(villager, after)).toBe(true);
  });

  it('не копятся в очередь: на остров их немного', () => {
    const crew = villagers(4).map((villager) => ({
      ...villager,
      wish: { kind: 'plant_nearby' as const, createdAt: 1 },
    }));
    expect(activeWishes(crew)).toBeLessThanOrEqual(WISHES_PER_ISLAND);
  });

  it('исполнение убирает желание и не оставляет следа', () => {
    const crew = villagers(1).map((villager) => ({
      ...villager,
      favoriteSpot: { x: 60, y: 20, z: 60 },
      wish: { kind: 'bench_at_favorite_spot' as const, createdAt: 1 },
      position: { x: 60, y: 20, z: 60 },
    }));

    const result = simulateTick(
      { tick: 100, villagers: crew },
      {
        grid,
        scenicSpots,
        seed: SEED,
        buildings: [building('b1', 'bench', 60, 60)],
      },
    );

    expect(result.state.villagers[0]?.wish).toBeUndefined();
    expect(result.events.some((event) => event.kind === 'wish_done')).toBe(true);
  });
});

describe('праздник', () => {
  it('нужен очаг и еда, а не деньги', () => {
    const state = createWorldState(SEED);
    expect(validate({ t: 'host_festival' }, state, reader)).toEqual({
      ok: false,
      reason: 'needs_firepit',
    });

    state.buildings.push(building('b1', 'firepit', 50, 50));
    expect(validate({ t: 'host_festival' }, state, reader)).toEqual({
      ok: false,
      reason: 'cannot_afford',
    });

    for (const [id, amount] of Object.entries(FESTIVAL_COST)) {
      state.resources[id as keyof typeof state.resources] = amount;
    }
    expect(validate({ t: 'host_festival' }, state, reader)).toEqual({ ok: true });
  });

  it('тратит еду и приносит вдохновение', () => {
    const state = createWorldState(SEED);
    state.buildings.push(building('b1', 'firepit', 50, 50));
    state.resources.meal = 10;
    state.resources.fruit = 10;

    commitEffect(state, applyCommand({ t: 'host_festival' }, state, reader, 0));

    expect(state.resources.meal).toBe(10 - (FESTIVAL_COST.meal ?? 0));
    expect(state.resources.inspiration).toBe(FESTIVAL_INSPIRATION);
  });

  it('пока идёт, все празднуют, а не работают', () => {
    const crew = villagers(4);
    const result = simulateTick(
      { tick: 10, villagers: crew },
      { grid, scenicSpots, seed: SEED, festivalUntilTick: 100 },
    );

    for (const villager of result.state.villagers) {
      expect(villager.state).toBe('celebrate');
    }
  });
});

describe('вдохновение', () => {
  it('не берётся ни за что, кроме уюта и культуры', () => {
    // Проверка идёт по каталогу целиком: если однажды вдохновение попадёт в цену
    // лесопилки, тест поймает это раньше игрока (§4 ТЗ).
    for (const type of BUILDINGS) {
      if ((type.cost.inspiration ?? 0) === 0) continue;
      expect(['culture', 'decor'], `${type.id}: ${type.category}`).toContain(type.category);
    }
  });

  it('на острове начинается с нуля и берётся только из событий', () => {
    expect(createWorldState(SEED).resources.inspiration).toBe(0);
  });
});

describe('главы', () => {
  it('их ровно пять и у каждой есть имя', () => {
    expect(CHAPTERS).toHaveLength(5);
    for (const chapter of CHAPTERS) {
      expect(chapter.name.length).toBeGreaterThan(3);
      expect(chapterInfo(chapter.number).name).toBe(chapter.name);
    }
  });

  it('переключаются по вехе, а не по списку заданий', () => {
    const base = { villagers: [], buildings: [], resources: {}, festivals: 0, comfort: 0 };
    expect(earnedChapter(base)).toBe(1);

    const eight = villagers(4).concat(villagers(4));
    expect(earnedChapter({ ...base, villagers: eight, comfort: 60 })).toBe(2);
    expect(earnedChapter({ ...base, resources: { tool: 1 } })).toBe(3);
    expect(earnedChapter({ ...base, festivals: 1 })).toBe(4);
  });

  it('не откатываются назад', () => {
    const poor = { villagers: [], buildings: [], resources: {}, festivals: 0, comfort: 0 };
    expect(nextChapter(4, poor)).toBe(4);
  });

  it('считают дружбы по парам, а не по сторонам', () => {
    const crew = villagers(2);
    const [first, second] = crew;
    if (first === undefined || second === undefined) throw new Error('нет жителей');

    first.bonds.push({ withId: second.id, level: 2, points: 500 });
    second.bonds.push({ withId: first.id, level: 2, points: 500 });

    expect(countFriendships(crew)).toBe(1);
  });
});
