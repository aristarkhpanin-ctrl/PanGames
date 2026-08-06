import { distance2D } from '../math';
import type { Bond, Vec3, Villager } from '../types';
import { columnIndex } from '../voxels';
import { isWalkable, type NavGrid } from './navigation';
import { TICKS_PER_DAY } from './time';

/**
 * Отношения, любимые места и возраст (§5 ТЗ).
 *
 * §5 отдельно предупреждает про любимые места: не срезать, это одна из самых сильных
 * механик игры. Житель сам выбирает точку на острове и ходит туда — а игрок однажды
 * замечает это и ставит там скамейку. Ради такого игру и открывают.
 *
 * Отношения только растут. Ссор, ревности и расставаний здесь нет и не будет — устав.
 */

/** Сколько очков даёт один тик разговора рядом. */
const BOND_POINTS_PER_TICK = 4;

/** Как близко надо быть, чтобы разговор считался общим. */
const BOND_RADIUS = 6;

/** Пороги уровней: знакомы → приятели → друзья → близкие (§5 ТЗ). */
export const BOND_LEVELS: readonly number[] = [0, 120, 400, 1000];

/** Через сколько игровых дней житель выбирает себе любимое место (§5 ТЗ). */
export const FAVORITE_SPOT_DAYS = 2;

/** Через сколько игровых дней житель становится хранителем историй. */
export const KEEPER_DAYS = 40;

export function bondLevel(points: number): 0 | 1 | 2 | 3 {
  let level = 0;
  for (const [index, threshold] of BOND_LEVELS.entries()) {
    if (points >= threshold) level = index;
  }
  return level as 0 | 1 | 2 | 3;
}

/** Словом — для карточки жителя. Проценты и очки игроку не показываются никогда (§8 ТЗ). */
export function bondWord(level: 0 | 1 | 2 | 3): string {
  return ['знакомы', 'приятели', 'друзья', 'близкие'][level] ?? 'знакомы';
}

/**
 * Копит очки связи между теми, кто сейчас разговаривает рядом.
 *
 * Мутирует переданных жителей — их уже скопировал тик симуляции. Возвращает пары,
 * у которых уровень поднялся: это событие для дневника, а не просто число.
 */
export function growBonds(
  villagers: Villager[],
): { a: Villager; b: Villager; level: 0 | 1 | 2 | 3 }[] {
  const risen: { a: Villager; b: Villager; level: 0 | 1 | 2 | 3 }[] = [];

  for (let i = 0; i < villagers.length; i += 1) {
    const first = villagers[i];
    if (first?.state !== 'socialize') continue;

    for (let j = i + 1; j < villagers.length; j += 1) {
      const second = villagers[j];
      if (second?.state !== 'socialize') continue;

      const apart = distance2D(
        first.position.x,
        first.position.z,
        second.position.x,
        second.position.z,
      );
      if (apart > BOND_RADIUS) continue;

      const before = bondLevel(pointsBetween(first, second));
      const after = addPoints(first, second, BOND_POINTS_PER_TICK);
      if (after > before) risen.push({ a: first, b: second, level: after });
    }
  }

  return risen;
}

function pointsBetween(first: Villager, second: Villager): number {
  return first.bonds.find((bond) => bond.withId === second.id)?.points ?? 0;
}

/** Связь всегда взаимная: одностороннюю дружбу игра не показывает и показывать не должна. */
function addPoints(first: Villager, second: Villager, points: number): 0 | 1 | 2 | 3 {
  const total = pointsBetween(first, second) + points;
  const level = bondLevel(total);

  write(first, second.id, total, level);
  write(second, first.id, total, level);
  return level;
}

function write(villager: Villager, withId: string, points: number, level: 0 | 1 | 2 | 3): void {
  const existing = villager.bonds.find((bond) => bond.withId === withId);
  if (existing === undefined) {
    const bond: Bond = { withId, level, points };
    villager.bonds.push(bond);
    return;
  }
  existing.points = points;
  existing.level = level;
}

/** Кто с кем дружит — для карточки жителя. */
export function friendsOf(villager: Villager, everyone: readonly Villager[]): Villager[] {
  return villager.bonds
    .filter((bond) => bond.level >= 2)
    .map((bond) => everyone.find((person) => person.id === bond.withId))
    .filter((person): person is Villager => person !== undefined);
}

/**
 * Выбор любимого места.
 *
 * Житель выбирает его сам, примерно через два дня жизни, и не абы где: место должно быть
 * проходимым, недалеко от того, где он бывает, и с видом — то есть у воды или на возвышении.
 * Возвращает `null`, если выбирать рано или не из чего.
 */
export function chooseFavoriteSpot(
  villager: Villager,
  grid: NavGrid,
  scenicSpots: readonly Vec3[],
  tick: number,
): Vec3 | null {
  if (villager.favoriteSpot !== undefined) return null;
  if (ageInDays(villager, tick) < FAVORITE_SPOT_DAYS) return null;
  if (scenicSpots.length === 0) return null;

  // Из красивых мест берётся ближайшее к тому, где житель ходит: любимое место должно быть
  // по дороге, а не на другом конце острова.
  let best: Vec3 | null = null;
  let bestDistance = Infinity;

  for (const spot of scenicSpots) {
    if (!isWalkable(grid, spot.x, spot.z)) continue;

    const distance = distance2D(spot.x, spot.z, villager.position.x, villager.position.z);
    // Небольшой разброс по сиду: иначе все четверо облюбуют одну и ту же скамейку.
    const preference = distance + ((villager.seed + spot.x * 31 + spot.z * 17) % 12);
    if (preference >= bestDistance) continue;

    bestDistance = preference;
    best = {
      x: spot.x,
      y: (grid.height[columnIndex(spot.x, spot.z)] ?? spot.y - 1) + 1,
      z: spot.z,
    };
  }

  return best;
}

/** Сколько игровых дней житель живёт на острове. */
export function ageInDays(villager: Villager, tick: number): number {
  return Math.max(0, tick - (villager.arrivedAtTick ?? 0)) / TICKS_PER_DAY;
}

/**
 * Хранитель историй (§5 ТЗ): пожилой житель не работает, но делает остров теплее.
 *
 * Никто не умирает и не угасает — старость здесь это про уважение, а не про убыль
 * (устав, п. 1).
 */
export function isKeeper(villager: Villager, tick: number): boolean {
  return ageInDays(villager, tick) >= KEEPER_DAYS;
}
