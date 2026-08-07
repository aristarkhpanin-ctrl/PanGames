import { describe, expect, it } from 'vitest';

import { autoAssignments } from './assign';
import { comfortAt, type PlacedBuilding } from './economy';
import {
  CHILD_COMFORT,
  CHILD_DAYS,
  canWork,
  childComfortAt,
  daysToGrowUp,
  DEFAULT_SETTINGS,
  expectingHome,
  grewUpThisTick,
  isChild,
  newborn,
} from './family';
import { TICKS_PER_DAY } from './time';
import { createStartingVillagers } from './villager';
import { createWorldState } from './world';
import type { Villager } from '../types';

/**
 * Дети и семьи (§5 ТЗ). Механика необязательная, поэтому первая проверка — что по умолчанию
 * её нет вовсе. Остальные — что ребёнок это подарок, а не обязанность: он не работает,
 * прибавляет уюта и через семь дней просто становится взрослым.
 */

const SEED = 42;
const AT = { x: 40, y: 34, z: 40 };

function people(count: number): Villager[] {
  return createStartingVillagers(
    SEED,
    'island',
    Array.from({ length: count }, (_, i) => ({ x: AT.x + i, y: AT.y, z: AT.z })),
  ).slice(0, count);
}

function bigHome(residents: string[]): PlacedBuilding {
  return {
    id: 'home-1',
    // Общий дом: кроватей хватает, значит третьему есть где спать.
    typeId: 'commons',
    x: AT.x,
    y: AT.y,
    z: AT.z,
    rotation: 0,
    level: 1,
    workers: [],
    residents,
    progress: 1,
    builtAtTick: 0,
  };
}

describe('семьи', () => {
  it('по умолчанию выключены', () => {
    expect(DEFAULT_SETTINGS.families).toBe(false);
  });

  it('ребёнок появляется только у близких с местом в доме и уютом вокруг', () => {
    const villagers = people(2);
    const [first, second] = villagers;
    if (first === undefined || second === undefined) throw new Error('нужны двое');

    const home = bigHome([first.id, second.id]);
    const warm = (): number => 20;
    const cold = (): number => 0;

    // Пока они просто соседи — ничего не происходит, и это не ошибка.
    expect(expectingHome(villagers, [home], warm)).toBeNull();

    first.bonds = [{ withId: second.id, level: 3, points: 1200 }];
    expect(expectingHome(villagers, [home], warm)).not.toBeNull();

    // Неуютно — тоже ничего. Ни строки упрёка, ни «условия не выполнены».
    expect(expectingHome(villagers, [home], cold)).toBeNull();

    // Нет свободной кровати — тоже ничего.
    const full = { ...home, residents: [first.id, second.id, 'a', 'b'] };
    expect(expectingHome(villagers, [full], warm)).toBeNull();
  });

  it('в шалаше ребёнку негде спать', () => {
    const villagers = people(2);
    const [first, second] = villagers;
    if (first === undefined || second === undefined) throw new Error('нужны двое');
    first.bonds = [{ withId: second.id, level: 3, points: 1200 }];

    const hut = { ...bigHome([first.id, second.id]), typeId: 'hut' };
    expect(expectingHome(villagers, [hut], () => 20)).toBeNull();
  });

  it('ребёнок взрослеет ровно за семь дней и не работает до этого', () => {
    const [child] = people(1);
    if (child === undefined) throw new Error('нужен житель');
    child.bornAtTick = 0;

    expect(isChild(child, 0)).toBe(true);
    expect(canWork(child, 0)).toBe(false);
    expect(daysToGrowUp(child, 0)).toBe(CHILD_DAYS);

    const grownAt = CHILD_DAYS * TICKS_PER_DAY;
    expect(isChild(child, grownAt - 1)).toBe(true);
    expect(isChild(child, grownAt)).toBe(false);
    expect(canWork(child, grownAt)).toBe(true);
    expect(grewUpThisTick(child, grownAt)).toBe(true);
    expect(grewUpThisTick(child, grownAt + 1)).toBe(false);
  });

  it('приплывший взрослым ребёнком не считается никогда', () => {
    const [adult] = people(1);
    if (adult === undefined) throw new Error('нужен житель');
    adult.arrivedAtTick = 0;

    expect(isChild(adult, 0)).toBe(false);
    expect(canWork(adult, 0)).toBe(true);
  });

  it('ребёнка не назначают на работу, но дом ему ищут', () => {
    const state = createWorldState(SEED);
    state.buildings = [
      bigHome([]),
      {
        id: 'job-1',
        typeId: 'woodcutter',
        x: AT.x + 6,
        y: AT.y,
        z: AT.z,
        rotation: 0,
        level: 1,
        workers: [],
        residents: [],
        progress: 1,
        builtAtTick: 0,
      },
    ];

    const [child] = people(1);
    if (child === undefined) throw new Error('нужен житель');
    child.bornAtTick = 0;

    const commands = autoAssignments(state, [child], { tick: 10 });
    expect(commands.some((c) => c.t === 'assign_home')).toBe(true);
    expect(commands.some((c) => c.t === 'assign_job')).toBe(false);

    // Повзрослел — работа находится сама.
    const later = autoAssignments(state, [child], { tick: CHILD_DAYS * TICKS_PER_DAY });
    expect(later.some((c) => c.t === 'assign_job')).toBe(true);
  });

  it('ребёнок прибавляет уюта рядом с собой', () => {
    const [child] = people(1);
    if (child === undefined) throw new Error('нужен житель');
    child.bornAtTick = 0;
    child.position = { x: AT.x, y: AT.y, z: AT.z };

    const here = childComfortAt({ x: AT.x, z: AT.z }, [child], 0);
    expect(here).toBeCloseTo(CHILD_COMFORT, 5);
    expect(childComfortAt({ x: AT.x + 40, z: AT.z }, [child], 0)).toBe(0);

    // Взрослый уюта таким способом не даёт: это про малышей, а не про людей вообще.
    expect(childComfortAt({ x: AT.x, z: AT.z }, [child], CHILD_DAYS * TICKS_PER_DAY)).toBe(0);
  });

  it('уют от ребёнка попадает в общий расчёт', () => {
    const spot = { x: AT.x, z: AT.z };
    const without = comfortAt(spot, [], []);
    const withChild = comfortAt(spot, [], [], [spot]);
    expect(withChild).toBeGreaterThan(without);
  });
});

describe('малыш', () => {
  it('собирается как обычный житель и помнит, чей он', () => {
    const villagers = people(2);
    const [first, second] = villagers;
    if (first === undefined || second === undefined) throw new Error('нужны двое');
    first.bonds = [{ withId: second.id, level: 3, points: 1200 }];

    const home = bigHome([first.id, second.id]);
    const expecting = expectingHome(villagers, [home], () => 20);
    if (expecting === null) throw new Error('никого не ждут');

    const baby = newborn(SEED, 'island', 'villager-9', expecting, 500);
    if (baby === null) throw new Error('малыш не собрался');

    expect(baby.id).toBe('villager-9');
    expect(baby.bornAtTick).toBe(500);
    expect(baby.arrivedAtTick).toBe(500);
    expect(baby.parents).toEqual([first.id, second.id]);
    expect(baby.bonds).toEqual([]);
    expect(baby.name.length).toBeGreaterThan(0);
    expect(baby.traits).toHaveLength(2);

    // Появляется он дома, а не посреди острова.
    expect(baby.position.x).toBe(home.x);
    expect(baby.position.z).toBe(home.z);

    expect(isChild(baby, 500)).toBe(true);
    expect(canWork(baby, 500)).toBe(false);
  });

  it('один и тот же сид даёт того же ребёнка', () => {
    const villagers = people(2);
    const [first, second] = villagers;
    if (first === undefined || second === undefined) throw new Error('нужны двое');
    first.bonds = [{ withId: second.id, level: 3, points: 1200 }];

    const expecting = expectingHome(villagers, [bigHome([first.id, second.id])], () => 20);
    if (expecting === null) throw new Error('никого не ждут');

    expect(newborn(7, 'island', 'villager-9', expecting, 500)).toEqual(
      newborn(7, 'island', 'villager-9', expecting, 500),
    );
  });
});
