import { describe, expect, it } from 'vitest';

import { TRAITS } from '../content/traits';
import type { Vec3 } from '../types';
import { columnIndex, Material, voxelIndex, WORLD_X, WORLD_Y } from '../voxels';
import { generateIsland } from '../worldgen/island';
import { buildNavGrid, findPath, isWalkable, type NavGrid } from './navigation';
import { decayNeeds, fullNeeds, MOOD_FLOOR, moodWord, smoothMood, workerEfficiency } from './needs';
import { hourOfTick, TICKS_PER_DAY } from './time';
import { simulateTick, type SimState } from './tick';
import { createStartingVillagers, pickTraits, villagerLook } from './villager';
import type { WorldReader } from './world';

const SEED = 42;
const island = generateIsland(SEED);

const reader: WorldReader = {
  material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
};

const grid = buildNavGrid(reader);

/** Несколько проходимых клеток для высадки. */
function spawnPoints(count: number): Vec3[] {
  const points: Vec3[] = [];
  for (let z = 10; z < 150 && points.length < count; z += 3) {
    for (let x = 10; x < 150 && points.length < count; x += 3) {
      if (!isWalkable(grid, x, z)) continue;
      points.push({ x, y: (grid.height[columnIndex(x, z)] ?? 0) + 1, z });
    }
  }
  return points;
}

const spawns = spawnPoints(4);
const scenicSpots = spawnPoints(24).slice(8);

function freshState(): SimState {
  return { tick: 0, villagers: createStartingVillagers(SEED, 'island-1', spawns) };
}

function run(state: SimState, ticks: number, navGrid: NavGrid = grid): SimState {
  let current = state;
  for (let i = 0; i < ticks; i += 1) {
    current = simulateTick(current, { grid: navGrid, scenicSpots, seed: SEED }).state;
  }
  return current;
}

describe('жители — личность', () => {
  it('из одного сида получается тот же человек', () => {
    const first = createStartingVillagers(SEED, 'island-1', spawns);
    const second = createStartingVillagers(SEED, 'island-1', spawns);
    expect(second).toEqual(first);
  });

  it('у каждого ровно две разные черты', () => {
    for (let seed = 1; seed < 300; seed += 1) {
      const [a, b] = pickTraits(seed);
      expect(a).not.toBe(b);
      expect(TRAITS.some((trait) => trait.id === a)).toBe(true);
      expect(TRAITS.some((trait) => trait.id === b)).toBe(true);
    }
  });

  it('внешность выводится из сида и не совпадает у всех подряд', () => {
    expect(villagerLook(7)).toEqual(villagerLook(7));
    const looks = new Set(
      Array.from({ length: 40 }, (_, i) => JSON.stringify(villagerLook(i + 1))),
    );
    expect(looks.size).toBeGreaterThan(20);
  });

  it('четверо стартовых носят разные имена', () => {
    const names = createStartingVillagers(SEED, 'island-1', spawns).map((v) => v.name);
    expect(new Set(names).size).toBe(4);
  });
});

describe('нужды и настроение', () => {
  it('нужды не выходят за границы даже за долгое время', () => {
    const drained = decayNeeds(fullNeeds(), 500);
    for (const value of Object.values(drained)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('настроение никогда не опускается ниже 20', () => {
    // Жёсткий порог устава. Проверяем и на пустых нуждах, и на испорченных входных данных.
    const empty = { food: 0, rest: 0, shelter: 0, social: 0, beauty: 0, purpose: 0 };
    expect(smoothMood(20, empty, 1000)).toBeGreaterThanOrEqual(MOOD_FLOOR);
    expect(smoothMood(0, empty, 1000)).toBeGreaterThanOrEqual(MOOD_FLOOR);
    expect(smoothMood(50, { ...empty, food: -100, rest: -100 }, 100)).toBeGreaterThanOrEqual(
      MOOD_FLOOR,
    );
  });

  it('резкий провал нужды не роняет настроение мгновенно', () => {
    const before = 85;
    const after = smoothMood(
      before,
      { food: 0, rest: 0, shelter: 0, social: 0, beauty: 0, purpose: 0 },
      1 / 6,
    );
    // За десять игровых минут человек не превращается из светящегося в грустящего.
    expect(after).toBeGreaterThan(before - 10);
  });

  it('настроение показывается словом, а не процентом', () => {
    expect(moodWord(90)).toBe('светится');
    expect(moodWord(72)).toBe('радуется');
    expect(moodWord(60)).toBe('спокоен');
    expect(moodWord(45)).toBe('задумчив');
    expect(moodWord(25)).toBe('грустит');
  });

  it('эффективность работника никогда не ниже 0.5', () => {
    // Второй жёсткий порог устава: остров не сваливается в спираль.
    for (let mood = -50; mood <= 150; mood += 1) {
      expect(workerEfficiency(mood)).toBeGreaterThanOrEqual(0.5);
      expect(workerEfficiency(mood)).toBeLessThanOrEqual(1.3);
    }
    expect(workerEfficiency(0, -5)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('навигация', () => {
  it('проходимые клетки есть, и их много', () => {
    let walkable = 0;
    for (const height of grid.height) if (height >= 0) walkable += 1;
    expect(walkable).toBeGreaterThan(5000);
  });

  it('вода непроходима', () => {
    let waterWalkable = 0;
    for (let i = 0; i < grid.height.length; i += 1) {
      if (island.shape.land[i] !== 1 && (grid.height[i] ?? -1) >= 0) waterWalkable += 1;
    }
    expect(waterWalkable).toBe(0);
  });

  it('путь между двумя точками суши находится и связен', () => {
    const from = spawns[0];
    const to = scenicSpots[3];
    if (from === undefined || to === undefined) throw new Error('нет точек для проверки');

    const path = findPath(grid, from, to);
    expect(path).not.toBeNull();
    if (path === null) return;

    expect(path[0]).toMatchObject({ x: from.x, z: from.z });
    expect(path[path.length - 1]).toMatchObject({ x: to.x, z: to.z });

    let broken = 0;
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      if (a === undefined || b === undefined) continue;
      const step = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
      if (step !== 1 || Math.abs(a.y - b.y) > 1) broken += 1;
    }
    expect(broken).toBe(0);
  });

  it('недостижимая цель возвращает отказ, а не поиск без конца', () => {
    // Клетка посреди открытого моря: дойти пешком нельзя.
    let waterX = -1;
    let waterZ = -1;
    for (let i = 0; i < island.shape.land.length && waterX === -1; i += 1) {
      if (island.shape.land[i] === 0) {
        waterX = i % WORLD_X;
        waterZ = (i - waterX) / WORLD_X;
      }
    }
    const from = spawns[0];
    if (from === undefined) throw new Error('нет точки старта');
    expect(findPath(grid, from, { x: waterX, z: waterZ })).toBeNull();
  });

  it('дорога делает путь дешевле', () => {
    // Ставим дорожку и убеждаемся, что стоимость клетки упала вдвое.
    const cell = spawns[1];
    if (cell === undefined) throw new Error('нет клетки');
    const plain = grid.cost[columnIndex(cell.x, cell.z)] ?? 1;

    const paved = new Uint8Array(island.voxels);
    paved[voxelIndex(cell.x, cell.y - 1, cell.z)] = Material.PATH;
    const pavedGrid = buildNavGrid({
      material: (x, y, z) => paved[voxelIndex(x, y, z)] ?? Material.AIR,
    });

    expect(pavedGrid.cost[columnIndex(cell.x, cell.z)]).toBeLessThan(plain);
  });
});

describe('тик симуляции', () => {
  it('детерминирован: одно состояние и один сид дают один результат', () => {
    const a = run(freshState(), 60);
    const b = run(freshState(), 60);
    expect(b).toEqual(a);
  });

  it('жители не стоят на месте сутки напролёт', () => {
    const start = freshState();
    const after = run(start, TICKS_PER_DAY);

    const moved = after.villagers.filter((villager, index) => {
      const before = start.villagers[index];
      if (before === undefined) return false;
      return villager.position.x !== before.position.x || villager.position.z !== before.position.z;
    });

    expect(moved.length).toBeGreaterThan(0);
  });

  it('за сутки житель успевает и поспать, и поесть, и осмотреться', () => {
    let state = freshState();
    const seen = new Set<string>();

    for (let i = 0; i < TICKS_PER_DAY * 2; i += 1) {
      const result = simulateTick(state, { grid, scenicSpots, seed: SEED });
      state = result.state;
      for (const villager of state.villagers) seen.add(villager.state);
    }

    expect(seen.has('sleep')).toBe(true);
    expect(seen.has('eat')).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('ночью спят, днём не спят', () => {
    let state = freshState();
    let sleepingAtNight = 0;
    let sleepingAtNoon = 0;

    for (let i = 0; i < TICKS_PER_DAY * 3; i += 1) {
      state = simulateTick(state, { grid, scenicSpots, seed: SEED }).state;
      const hour = hourOfTick(state.tick);
      const sleepers = state.villagers.filter((v) => v.state === 'sleep').length;
      if (hour >= 1 && hour < 4) sleepingAtNight += sleepers;
      if (hour >= 11 && hour < 14) sleepingAtNoon += sleepers;
    }

    expect(sleepingAtNight).toBeGreaterThan(sleepingAtNoon);
  });

  it('действие не пересматривается каждый тик', () => {
    // Иначе житель дёргается и выглядит нервным, а игра про спокойствие.
    let state = freshState();
    let changes = 0;
    const previous = new Map(state.villagers.map((v) => [v.id, v.state]));

    for (let i = 0; i < 60; i += 1) {
      state = simulateTick(state, { grid, scenicSpots, seed: SEED }).state;
      for (const villager of state.villagers) {
        if (previous.get(villager.id) !== villager.state) changes += 1;
        previous.set(villager.id, villager.state);
      }
    }

    // Четверо за 60 тиков: если бы решение пересматривалось каждый тик, вышло бы под 240.
    expect(changes).toBeLessThan(80);
  });

  it('жители остаются на проходимых клетках', () => {
    const after = run(freshState(), TICKS_PER_DAY);
    for (const villager of after.villagers) {
      expect(isWalkable(grid, villager.position.x, villager.position.z)).toBe(true);
      expect(villager.position.y).toBeGreaterThan(0);
      expect(villager.position.y).toBeLessThan(WORLD_Y);
    }
  });

  it('бюджет путей за тик соблюдается', () => {
    // Больше пяти поисков за тик — это провал кадра на полном острове (§12 ТЗ).
    let state: SimState = {
      tick: 0,
      villagers: createStartingVillagers(SEED, 'i', spawnPoints(60)),
    };
    let maxStarts = 0;

    for (let i = 0; i < 40; i += 1) {
      const result = simulateTick(state, { grid, scenicSpots, seed: SEED });
      state = result.state;
      const walkers = state.villagers.filter((v) => v.state === 'walk' && v.pathIndex === 0).length;
      maxStarts = Math.max(maxStarts, walkers);
    }

    expect(maxStarts).toBeLessThanOrEqual(5);
  });
});

describe('устав — исполняемая проверка', () => {
  it('без еды, дома и работы через тысячу тиков все живы и никто не ушёл', () => {
    // Это дизайн-документ в виде теста. Никто не умирает и не уходит; настроение
    // не опускается ниже 20; отрицательных величин не появляется (устав, п. 1 и 2).
    const state = freshState();
    for (const villager of state.villagers) {
      villager.needs = { food: 0, rest: 0, shelter: 0, social: 0, beauty: 0, purpose: 0 };
      villager.mood = MOOD_FLOOR;
    }

    // Пустой граф: идти некуда, работать негде, есть нечего.
    const barren: NavGrid = {
      height: new Int16Array(grid.height.length).fill(-1),
      cost: new Float32Array(grid.cost.length).fill(1),
    };

    const after = run(state, 1000, barren);

    expect(after.villagers).toHaveLength(4);
    for (const villager of after.villagers) {
      expect(villager.mood).toBeGreaterThanOrEqual(MOOD_FLOOR);
      expect(villager.mood).toBeLessThanOrEqual(100);
      for (const value of Object.values(villager.needs)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });
});
