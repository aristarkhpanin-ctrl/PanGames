import type { ResourceId } from '../types';

/**
 * Открытки и подарки (§9 ТЗ) — данные, не код.
 *
 * Открытка собирается **из готового набора фраз и стикеров, без свободного текста**. Это
 * не ограничение ради удобства, а решение целиком: свободного текста нет — значит, нет
 * и модерации, нет оскорблений, нет спама и нет способа испортить кому-то остров словами.
 *
 * Ни одна фраза не оценивает остров и не сравнивает его с другими: ни «красиво», ни «лучше»,
 * ни «у тебя круче». Ноль соревнования — устав, п. 7.
 */

export interface Postcard {
  id: string;
  /** Что написано. Целая фраза: собирать её из кусков — верный путь к нелепице. */
  text: string;
}

export const POSTCARDS: readonly Postcard[] = [
  { id: 'was_here', text: 'Заходил посмотреть. Тут хорошо' },
  { id: 'quiet', text: 'У вас тихо. Посидел на берегу' },
  { id: 'sea', text: 'Долго смотрел на воду' },
  { id: 'thanks', text: 'Спасибо, что позвал' },
  { id: 'evening', text: 'Заглянул вечером — фонари горят' },
  { id: 'again', text: 'Ещё зайду' },
  { id: 'people', text: 'Ваши жители мне понравились' },
  { id: 'garden', text: 'Погулял между домов' },
  { id: 'gift', text: 'Оставил кое-что в порту' },
  { id: 'hello', text: 'Просто зашёл поздороваться' },
  { id: 'wind', text: 'Ветер у вас с моря тёплый' },
  { id: 'stay', text: 'Хотел бы тут пожить' },
];

export function postcard(id: string): Postcard | undefined {
  return POSTCARDS.find((card) => card.id === id);
}

/**
 * Что можно подарить. Подарок берётся **из склада гостя**: отдающий действительно отдаёт,
 * а не создаёт из воздуха.
 */
export interface GiftKind {
  id: string;
  name: string;
  gives: Partial<Record<ResourceId, number>>;
}

export const GIFTS: readonly GiftKind[] = [
  // Первый в списке — самый скромный: подарить что-нибудь должно быть можно и в первый день.
  { id: 'fruit', name: 'Горсть фруктов', gives: { fruit: 4 } },
  { id: 'firewood', name: 'Охапка дров', gives: { wood: 6 } },
  { id: 'seeds', name: 'Мешочек семян', gives: { fiber: 10, grain: 10 } },
  { id: 'planks', name: 'Связка досок', gives: { plank: 12 } },
  { id: 'stones', name: 'Корзина камня', gives: { stone: 15 } },
  { id: 'basket', name: 'Корзина еды', gives: { fruit: 12, fish: 6 } },
  { id: 'shells', name: 'Горсть ракушек', gives: { shell: 10 } },
  { id: 'cloth', name: 'Отрез ткани', gives: { cloth: 6 } },
];

export function giftKind(id: string): GiftKind | undefined {
  return GIFTS.find((gift) => gift.id === id);
}

/** Как часто один гость может дарить одному острову. Чтобы это не превращалось в ферму. */
export const GIFT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
