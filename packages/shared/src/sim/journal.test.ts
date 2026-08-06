import { describe, expect, it } from 'vitest';

import {
  JOURNAL_ASIDES,
  JOURNAL_LINES,
  JOURNAL_TRAIT_ASIDES,
  QUIET_NEEDS,
  dayPartOf,
  type JournalKind,
} from '../content/journalTemplates';
import type { Needs } from '../types';
import { entrySeed, quietNeedLine, writeEntry } from './journal';

/**
 * Дневник проверяется по двум осям сразу: он не должен приедаться и не должен рожать
 * грамматических уродцев. Обе проверки идут по самим шаблонам — так ошибка находится
 * в момент написания строки, а не через месяц у игрока.
 */

const KINDS = Object.keys(JOURNAL_LINES) as JournalKind[];

/** Все строки шаблонов разом: главные фразы, добавки и тихие наблюдения. */
function allTemplates(): { where: string; line: string }[] {
  const all: { where: string; line: string }[] = [];

  for (const [kind, lines] of Object.entries(JOURNAL_LINES)) {
    for (const line of lines) all.push({ where: `JOURNAL_LINES.${kind}`, line });
  }
  for (const [part, lines] of Object.entries(JOURNAL_ASIDES)) {
    for (const line of lines) all.push({ where: `JOURNAL_ASIDES.${part}`, line });
  }
  for (const [trait, lines] of Object.entries(JOURNAL_TRAIT_ASIDES)) {
    for (const line of lines) all.push({ where: `JOURNAL_TRAIT_ASIDES.${trait}`, line });
  }
  for (const [need, lines] of Object.entries(QUIET_NEEDS)) {
    for (const line of lines) all.push({ where: `QUIET_NEEDS.${need}`, line });
  }

  return all;
}

describe('шаблоны дневника', () => {
  it('не ставят имя после предлога: имена склоняются', () => {
    const afterPreposition =
      /\b(у|к|для|с|со|о|об|при|от|до|про|над|под|за|без|перед)\s+\{(name|other)\}/iu;

    for (const { where, line } of allTemplates()) {
      expect(line, `${where}: ${line}`).not.toMatch(afterPreposition);
    }
  });

  it('не ставят рядом с именем глагол прошедшего времени: у жителей нет рода', () => {
    // И после имени («Мира переехал»), и до него («приплыл Мира») — согласование одинаково.
    // `\b` в JavaScript определена по латинице и на кириллице не срабатывает вовсе —
    // границу слова приходится задавать явно, иначе проверка молча пропускает всё.
    const edge = '(?=$|[\\s,.:;—])';
    const after = new RegExp(`\\{(name|other)\\}\\s+\\S*(л|ла|ло|лся|лась)${edge}`, 'u');
    const before = new RegExp(`\\S*(л|ла|ло|лся|лась)${edge}\\s+\\{(name|other)\\}`, 'u');

    for (const { where, line } of allTemplates()) {
      expect(line, `${where}: ${line}`).not.toMatch(after);
      expect(line, `${where}: ${line}`).not.toMatch(before);
    }
  });

  it('не ставят рядом с именем краткое прилагательное: оно тоже согласуется', () => {
    const short =
      /\{(name|other)\}\s+(рад|доволен|счастлив|весел|горд|спокоен|занят)(?=$|[\s,.:;—])/u;

    for (const { where, line } of allTemplates()) {
      expect(line, `${where}: ${line}`).not.toMatch(short);
    }
  });

  it('ставят название только после двоеточия или тире: названия склоняются', () => {
    // «Достроили лесопилка» и «шалаш готова» — ошибки из той же семьи, что и с именами.
    for (const { where, line } of allTemplates()) {
      if (!line.includes('{what}')) continue;
      expect(line, `${where}: ${line}`).toMatch(/[:—]\s\{what\}/u);
    }
  });

  it('ни одна строка не кричит и не подгоняет', () => {
    const forbidden = ['!', 'внимание', 'срочно', 'нужно срочно', 'скорее', 'не забудь', 'вернись'];

    for (const { where, line } of allTemplates()) {
      const lower = line.toLowerCase();
      for (const word of forbidden) {
        expect(lower, `${where}: ${line}`).not.toContain(word);
      }
    }
  });

  it('не говорят языком системы', () => {
    const systemSpeak = [
      'ошибка',
      'статус',
      'сектор',
      'уровень нехватки',
      'показатель',
      'значение',
    ];

    for (const { where, line } of allTemplates()) {
      const lower = line.toLowerCase();
      for (const word of systemSpeak) {
        expect(lower, `${where}: ${line}`).not.toContain(word);
      }
    }
  });
});

describe('записи дневника', () => {
  it('на тысяче событий почти не повторяются', () => {
    const texts: string[] = [];
    let previous: string | undefined;

    for (let i = 0; i < 1000; i += 1) {
      const kind = KINDS[i % KINDS.length];
      if (kind === undefined) continue;

      const text = writeEntry({
        kind,
        hour: (i * 7) % 24,
        seed: entrySeed(42, i, kind),
        name: 'Мира',
        other: 'Гор',
        what: 'скамейка',
        ...(i % 3 === 0 ? { trait: 'dreamer' as const } : {}),
        ...(previous === undefined ? {} : { previous }),
      });

      texts.push(text);
      previous = text;
    }

    const unique = new Set(texts).size;
    // Разнообразия должно хватать на месяцы, а не на вечер.
    expect(unique).toBeGreaterThan(600);
  });

  it('не повторяет предыдущую запись подряд', () => {
    let previous = writeEntry({ kind: 'day', hour: 12, seed: 1 });

    for (let i = 0; i < 200; i += 1) {
      const text = writeEntry({ kind: 'day', hour: 12, seed: 1, previous });
      expect(text).not.toBe(previous);
      previous = text;
    }
  });

  it('один и тот же сид всегда даёт один и тот же текст', () => {
    const draft = { kind: 'built' as const, hour: 9, seed: 12345, what: 'лесопилка' };
    expect(writeEntry(draft)).toBe(writeEntry(draft));
  });

  it('подставляет имена и названия во все места', () => {
    for (const kind of KINDS) {
      for (let seed = 0; seed < 8; seed += 1) {
        const text = writeEntry({
          kind,
          hour: 14,
          seed,
          name: 'Мира',
          other: 'Гор',
          what: 'скамейка',
        });
        expect(text).not.toContain('{');
        expect(text).not.toContain('}');
      }
    }
  });

  it('заканчивается точкой и начинается с большой буквы', () => {
    for (const kind of KINDS) {
      const text = writeEntry({ kind, hour: 8, seed: 3, name: 'Мира', other: 'Гор', what: 'дом' });
      expect(text.endsWith('.')).toBe(true);
      expect(text[0]).toBe(text[0]?.toUpperCase());
    }
  });
});

describe('тихие наблюдения', () => {
  it('молчат, когда всё в порядке', () => {
    const fine: Needs = { food: 90, rest: 80, shelter: 100, social: 70, beauty: 60, purpose: 75 };
    expect(quietNeedLine(fine, 1)).toBeNull();
  });

  it('называют самую тихую беду и не требуют ничего делать', () => {
    const hungry: Needs = { food: 10, rest: 80, shelter: 100, social: 70, beauty: 60, purpose: 75 };
    const line = quietNeedLine(hungry, 1);

    expect(line).not.toBeNull();
    expect(QUIET_NEEDS.food).toContain(line);
    expect(line).not.toContain('!');
  });
});

describe('время суток', () => {
  it('делит сутки без дыр', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(['dawn', 'morning', 'day', 'dusk', 'night']).toContain(dayPartOf(hour));
    }
  });
});
