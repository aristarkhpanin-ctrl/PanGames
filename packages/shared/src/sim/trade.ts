import type { ResourceId } from '../types';
import { ALL_RESOURCES, type PlacedBuilding } from './economy';
import { TICKS_PER_DAY } from './time';

/**
 * Торговые лодки и ракушки (§4, §8 ТЗ).
 *
 * Торговля здесь существует ровно ради одного: **тупик должен быть невозможен**. Кончился
 * камень — лодка привезёт. Поэтому курс спокойный, дефицита нет, спекуляции нет и торговли
 * между игроками тоже нет: с ней пришла бы экономика, а с экономикой — соревнование.
 *
 * Опоздать к лодке нельзя. Она приходит событием, а не таймером с обратным отсчётом:
 * либо ждёт, либо приплывёт снова.
 */

/** Сколько ракушек стоит единица базового ресурса. Курс один на всё и не меняется. */
export const SHELLS_PER_BASE = 1;

/** Сколько ракушек стоит единица переработанного. Дороже, но не втрое: это не рынок. */
export const SHELLS_PER_CRAFTED = 3;

/** Сколько ракушек даёт единица сданного ресурса. Меньше цены покупки, но без грабежа. */
export const SHELLS_FOR_GIVING = 0.5;

/** Сколько за раз можно купить у одной лодки. */
export const MAX_TRADE_AMOUNT = 40;

/** Как часто приходит лодка. Раз в игровые сутки — событие, а не расписание. */
export const BOAT_EVERY_TICKS = TICKS_PER_DAY;

/**
 * Сколько ракушек приносит хорошая жизнь за тик (§4 ТЗ).
 *
 * Жители дают их «за просто хорошую жизнь»: небольшой постоянный приток от уюта. Это и есть
 * страховка от тупика — даже остров, у которого кончилось всё, копит на первую покупку.
 */
export const SHELLS_PER_COMFORT_TICK = 0.02;

/** Что можно купить у лодки. Мягкие ресурсы не продаются: их не бывает в трюме. */
export const TRADABLE: readonly ResourceId[] = ALL_RESOURCES.filter(
  (id) => id !== 'shell' && id !== 'inspiration',
);

/** Есть ли на острове порт: без него лодке некуда причалить. */
export function hasHarbor(buildings: readonly PlacedBuilding[]): boolean {
  return buildings.some((building) => building.typeId === 'harbor' && building.progress >= 1);
}

/** Стоит ли ресурс дороже: переработанное дороже добытого. */
export function shellPrice(id: ResourceId): number {
  return CRAFTED.has(id) ? SHELLS_PER_CRAFTED : SHELLS_PER_BASE;
}

const CRAFTED = new Set<ResourceId>(['plank', 'brick', 'glass', 'cloth', 'bread', 'tool', 'meal']);

/** Сколько ракушек стоит купить столько-то. */
export function costInShells(id: ResourceId, amount: number): number {
  return Math.ceil(shellPrice(id) * amount);
}

/** Сколько ракушек дадут за сданное. */
export function shellsForGiving(amount: number): number {
  return Math.floor(amount * SHELLS_FOR_GIVING);
}

/** Приплыла ли лодка прямо сейчас. Ровно раз в сутки и только если есть порт. */
export function boatIsHere(tick: number, buildings: readonly PlacedBuilding[]): boolean {
  return hasHarbor(buildings) && tick % BOAT_EVERY_TICKS === 0;
}
