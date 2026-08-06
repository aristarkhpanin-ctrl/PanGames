import type { Chapter, Villager } from '../types';
import type { PlacedBuilding } from '../sim/economy';
import { totalBeds } from '../sim/economy';
import { bondLevel } from '../sim/social';

/**
 * Пять глав острова (§7 ТЗ) — данные, не код.
 *
 * Глава переключается по естественной вехе, а не по списку заданий: игрок не выполняет
 * условия, он просто живёт, и однажды остров становится другим. Название появляется
 * крупно, тихо и один раз — без модального окна, кнопки «продолжить» и списка наград.
 */

export interface ChapterInfo {
  number: Chapter;
  /** Как глава называется на экране. */
  name: string;
  /** Веха, по которой глава наступает. Показывается только в документации, не игроку. */
  milestone: string;
}

export const CHAPTERS: readonly ChapterInfo[] = [
  { number: 1, name: 'Прибытие', milestone: 'все четверо под крышей' },
  { number: 2, name: 'Обустройство', milestone: 'восемь жителей и уютно' },
  { number: 3, name: 'Ремёсла', milestone: 'первые инструменты' },
  { number: 4, name: 'Общность', milestone: 'пять дружеских связей или первый праздник' },
  { number: 5, name: 'Гавань', milestone: 'порт' },
];

export function chapterInfo(number: Chapter): ChapterInfo {
  return CHAPTERS[number - 1] ?? CHAPTERS[0] ?? { number: 1, name: 'Прибытие', milestone: '' };
}

export interface ChapterState {
  villagers: readonly Villager[];
  buildings: readonly PlacedBuilding[];
  resources: Readonly<Record<string, number>>;
  /** Сколько праздников уже было. */
  festivals: number;
  /** Средний уют по жилью. */
  comfort: number;
}

/**
 * Какая глава заслужена сейчас.
 *
 * Считается от текущего состояния, а не копится флагами: тогда глава не может «потеряться»
 * из-за пропущенного события, а откатиться назад ей всё равно не дадут — вызывающий берёт
 * максимум из текущей и заслуженной.
 */
export function earnedChapter(state: ChapterState): Chapter {
  if (state.buildings.some((building) => building.typeId === 'harbor' && building.progress >= 1)) {
    return 5;
  }

  const friendships = countFriendships(state.villagers);
  if (friendships >= 5 || state.festivals > 0) return 4;

  if ((state.resources.tool ?? 0) > 0) return 3;

  if (state.villagers.length >= 8 && state.comfort >= 50) return 2;

  return 1;
}

/** Глава не откатывается назад: остров не разучивается тому, чему научился. */
export function nextChapter(current: Chapter, state: ChapterState): Chapter {
  const earned = earnedChapter(state);
  return earned > current ? earned : current;
}

/** Сколько на острове пар, доросших до дружбы. Считается по одной стороне, а не по двум. */
export function countFriendships(villagers: readonly Villager[]): number {
  const pairs = new Set<string>();

  for (const villager of villagers) {
    for (const bond of villager.bonds) {
      if (bondLevel(bond.points) < 2) continue;
      const pair = [villager.id, bond.withId].sort().join('|');
      pairs.add(pair);
    }
  }

  return pairs.size;
}

/** Все ли под крышей — веха первой главы и заодно повод для записи в дневник. */
export function everyoneHoused(
  villagers: readonly Villager[],
  buildings: readonly PlacedBuilding[],
): boolean {
  if (villagers.length === 0) return false;
  return totalBeds(buildings) >= villagers.length;
}
