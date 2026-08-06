import {
  dayPartOf,
  JOURNAL_ASIDES,
  JOURNAL_LINES,
  JOURNAL_TRAIT_ASIDES,
  QUIET_NEEDS,
  type JournalKind,
} from '../content/journalTemplates';
import type { Needs, TraitId } from '../types';
import { deriveSeed } from '../worldgen/rng';

/**
 * Запись в дневник (§8 ТЗ) — чистая функция: событие плюс сид дают текст.
 *
 * Дневник — signature-элемент игры, и главное его свойство не в красоте отдельной записи,
 * а в том, что за месяц он не приедается. Достигается это комбинаторикой: главная фраза
 * зависит от события, вторая — от времени суток или характера автора, и обе выбираются
 * по сиду. Один и тот же факт не даёт двух одинаковых записей подряд.
 */

export interface JournalDraft {
  kind: JournalKind;
  /** Игровой час: от него зависит вторая фраза. */
  hour: number;
  /** Сид записи. Один и тот же сид всегда даёт один и тот же текст. */
  seed: number;
  name?: string;
  other?: string;
  what?: string;
  /** Черта характера автора: иногда добавляет свой оттенок. */
  trait?: TraitId;
  /** Текст предыдущей записи. Повторять его подряд нельзя. */
  previous?: string;
}

/** Из скольких раз добавка вообще появляется. Всегда — это тоже однообразие. */
const ASIDE_CHANCE = 3;

/** Сколько раз пробуем разойтись с предыдущей записью, прежде чем оставить как есть. */
const RETRIES = 4;

export function writeEntry(draft: JournalDraft): string {
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const text = compose(draft, draft.seed + attempt * 7919);
    if (text !== draft.previous) return text;
  }
  return compose(draft, draft.seed);
}

function compose(draft: JournalDraft, seed: number): string {
  // Каждая часть тянет свой поток из общего сида. Если брать один и тот же остаток,
  // главная фраза и добавка окажутся связаны намертво: восемь пар вместо шестидесяти четырёх.
  const main = fill(pickFrom(JOURNAL_LINES[draft.kind], stream(seed, 1)), draft);

  // Добавка появляется не всегда: запись должна дышать, а не идти ровным строем.
  if (stream(seed, 2) % ASIDE_CHANCE === 0) return `${main}.`;

  const aside = pickAside(draft, seed);
  return aside === null ? `${main}.` : `${main}. ${aside}.`;
}

function pickAside(draft: JournalDraft, seed: number): string | null {
  // Оттенок характера — реже пейзажа: он про автора, а не про день, и приедается быстрее.
  if (draft.trait !== undefined && stream(seed, 3) % 5 === 1) {
    const lines = JOURNAL_TRAIT_ASIDES[draft.trait];
    if (lines !== undefined) return pickFrom(lines, stream(seed, 4));
  }

  return pickFrom(JOURNAL_ASIDES[dayPartOf(draft.hour)], stream(seed, 5));
}

/** Независимый поток чисел из одного сида: перемешивание, а не сдвиг. */
function stream(seed: number, index: number): number {
  let value = (seed ^ (index * 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

function fill(template: string, draft: JournalDraft): string {
  return template
    .replace('{name}', draft.name ?? 'Кто-то')
    .replace('{other}', draft.other ?? 'кто-то ещё')
    .replace('{what}', draft.what ?? 'что-то');
}

function pickFrom(lines: readonly string[], seed: number): string {
  return lines[Math.abs(seed) % lines.length] ?? lines[0] ?? '';
}

/**
 * Тихое наблюдение о нужде (устав, п. 8).
 *
 * Проблема попадает в дневник наблюдением от лица жителя и без единого призыва: игрок сам
 * решит, делать с этим что-нибудь или нет. Возвращает `null`, когда всё в порядке —
 * запись ради записи не создаётся.
 */
export function quietNeedLine(needs: Needs, seed: number): string | null {
  let worst: keyof Needs | null = null;
  let lowest = 45;

  for (const [key, value] of Object.entries(needs) as [keyof Needs, number][]) {
    if (value >= lowest) continue;
    lowest = value;
    worst = key;
  }

  if (worst === null) return null;

  const lines = QUIET_NEEDS[worst];
  return lines === undefined ? null : pickFrom(lines, seed);
}

/** Сид записи: выводится из острова, тика и повода — один и тот же случай пишется одинаково. */
export function entrySeed(islandSeed: number, tick: number, label: string): number {
  return deriveSeed(islandSeed, `journal:${String(tick)}:${label}`);
}
