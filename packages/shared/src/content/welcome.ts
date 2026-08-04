import type { CatchUpEvent } from '../sim/aggregate';
import type { ResourceId } from '../types';

/**
 * Шаблоны экрана «Пока тебя не было» (§3 ТЗ) — данные, а не строки в компоненте.
 *
 * Это не отчёт, а маленькая радость. Поэтому здесь нет ни одной формулировки про потерю,
 * упущенную выгоду или «надо было зайти раньше»: остров жил, и ему было хорошо.
 * Вариантов по нескольку на случай — чтобы возвращение не приедалось.
 */

/** Что показать на карточке. Порядок в списке — это и есть приоритет отбора. */
export type WelcomeCardKind = 'settled' | 'hired' | 'built' | 'gathered' | 'calm';

export interface WelcomeCard {
  kind: WelcomeCardKind;
  /** Заголовок карточки: короткая фраза без точки. */
  title: string;
  /** Строка помельче. Пусто — карточке хватает заголовка. */
  note?: string;
}

/** Сколько карточек показывается. Меньше трёх — не экран, больше шести — уже отчёт (§3 ТЗ). */
export const MIN_CARDS = 3;
export const MAX_CARDS = 6;

/*
 * Имя всегда стоит подлежащим и всегда в настоящем времени.
 *
 * Имена в игре разного рода и без пометок (§5 ТЗ: житель — человек, а не роль), и они
 * склоняются: «Мира переехал» и «у Сева» — обе ошибки вылезают сразу, стоит поставить имя
 * после предлога или перед глаголом в прошедшем. Именительный падеж и настоящее время
 * снимают оба разом и звучат спокойнее — что этому экрану и нужно.
 */
const SETTLED = [
  '{name} обживается на новом месте',
  '{name} теперь под своей крышей',
  '{name} ночует дома',
];
const HIRED = ['{name} теперь при деле', '{name} берётся за дело', '{name} выходит на работу'];
const BUILT = ['Достроили: {what}', 'На острове появилась постройка: {what}', 'Готово: {what}'];
const BUILT_MANY = ['Достроили: {count}', 'Новые постройки: {count}'];
const GATHERED = ['На складе прибавилось: {what}', 'Собрали за это время: {what}'];
const STORAGE_FULL = ['Склад {what} полон доверху', '{what} набралось столько, что склад полон'];
const CALM = [
  'На острове было тихо',
  'Ничего особенного не случилось, и это хорошо',
  'Остров жил своим чередом',
];
const DOZED = ['Остров подрёмывал и ждал', 'Тут всё это время было спокойно'];

/**
 * Один и тот же случай описывается одинаково, пока он один и тот же: вариант выбирается
 * по сиду, а не наугад, — иначе перерисовка меняла бы текст под рукой.
 */
export function pick(lines: readonly string[], seed: number): string {
  return lines[Math.abs(seed) % lines.length] ?? lines[0] ?? '';
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export const WELCOME_TEMPLATES = {
  settled: SETTLED,
  hired: HIRED,
  built: BUILT,
  builtMany: BUILT_MANY,
  gathered: GATHERED,
  storageFull: STORAGE_FULL,
  calm: CALM,
  dozed: DOZED,
} as const;

/** Заголовок экрана. Не «отчёт» и не «итоги» — просто «пока тебя не было». */
export const WELCOME_TITLE = 'Пока тебя не было';

/** Сколько всего должно прибавиться, чтобы про склад стоило рассказывать. */
const GATHERED_WORTH_TELLING = 20;

/**
 * Стоит ли вообще показывать экран.
 *
 * Пустой отчёт хуже отсутствия отчёта: если ничего заметного не случилось, возвращение
 * должно быть просто возвращением, без экрана посередине.
 */
export function worthShowing(events: readonly CatchUpEvent[]): boolean {
  const aboutPeople = events.some(
    (event) => event.kind === 'built' || event.kind === 'settled' || event.kind === 'hired',
  );
  if (aboutPeople) return true;

  const gathered = events.reduce(
    (sum, event) => (event.kind === 'gathered' ? sum + event.amount : sum),
    0,
  );
  return gathered >= GATHERED_WORTH_TELLING;
}

/** Как назвать жителя, здание и ресурс. Слова живут в интерфейсе, отбор — здесь. */
export interface WelcomeNames {
  villager: (id: string) => string;
  building: (typeId: string) => string;
  /** «40 брёвен» — с числом и в нужном падеже. */
  resource: (id: ResourceId, amount: number) => string;
  /** «дерево» — просто название, без количества. */
  resourceLabel: (id: ResourceId) => string;
}

/**
 * Отбор карточек (§3 ТЗ): сначала про людей, потом про стройку, ресурсы — последними
 * и не всегда. Порядок именно такой, потому что игра про заботу о жителях, а не про склад.
 */
export function welcomeCards(
  events: readonly CatchUpEvent[],
  names: WelcomeNames,
  seed: number,
): WelcomeCard[] {
  const cards: WelcomeCard[] = [];

  for (const event of events) {
    if (event.kind !== 'settled') continue;
    cards.push({
      kind: 'settled',
      title: fill(pick(SETTLED, seed + cards.length), { name: names.villager(event.villagerId) }),
    });
  }

  for (const event of events) {
    if (event.kind !== 'hired') continue;
    cards.push({
      kind: 'hired',
      title: fill(pick(HIRED, seed + cards.length), { name: names.villager(event.villagerId) }),
    });
  }

  const built = events.filter((event) => event.kind === 'built');
  const first = built[0];
  if (built.length === 1 && first !== undefined) {
    cards.push({
      kind: 'built',
      title: fill(pick(BUILT, seed + cards.length), {
        what: names.building(first.typeId).toLowerCase(),
      }),
    });
  } else if (built.length > 1) {
    const what = built
      .map((event) => names.building(event.typeId))
      .join(', ')
      .toLowerCase();
    cards.push({ kind: 'built', title: fill(pick(BUILT_MANY, seed), { count: what }) });
  }

  // Ресурсы — самая скучная карточка. Она одна на всё и только если место осталось.
  const gathered = events.filter((event) => event.kind === 'gathered');
  if (gathered.length > 0 && cards.length < MAX_CARDS) {
    const what = gathered
      .slice(0, 3)
      .map((event) => names.resource(event.resource, event.amount))
      .join(', ');
    cards.push({ kind: 'gathered', title: fill(pick(GATHERED, seed), { what }) });
  }

  const filledUp = events.find((event) => event.kind === 'storage_full');
  if (filledUp !== undefined && cards.length < MAX_CARDS) {
    cards.push({
      kind: 'gathered',
      title: fill(pick(STORAGE_FULL, seed), { what: names.resourceLabel(filledUp.resource) }),
      note: 'Всё на месте, работа просто подождёт',
    });
  }

  // Экран не бывает совсем пустым, если уж показывается: спокойная карточка закрывает низ.
  if (cards.length < MIN_CARDS) {
    const dozed = events.some((event) => event.kind === 'dozed');
    cards.push({ kind: 'calm', title: pick(dozed ? DOZED : CALM, seed) });
  }

  return cards.slice(0, MAX_CARDS);
}
