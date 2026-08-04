import { describe, expect, it } from 'vitest';

import type { CatchUpEvent } from '../sim/aggregate';
import {
  welcomeCards,
  worthShowing,
  MAX_CARDS,
  WELCOME_TEMPLATES,
  type WelcomeNames,
} from './welcome';

/**
 * Экран возвращения — не отчёт, а маленькая радость (§3 ТЗ).
 * Поэтому проверяется не только отбор карточек, но и то, чего в них не бывает.
 */

const names: WelcomeNames = {
  villager: (id) => (id === 'villager-1' ? 'Мира' : 'Гор'),
  building: (typeId) => (typeId === 'hut' ? 'Шалаш' : 'Лесопилка'),
  resource: (id, amount) => `${String(amount)} ${id}`,
  resourceLabel: (id) => id,
};

/** Слова, которых на этом экране быть не может ни при каких событиях. */
const FORBIDDEN = [
  'потер',
  'упущ',
  'штраф',
  'пропал',
  'испорт',
  'вернись',
  'скорее',
  'не забывай',
  '!',
  '%',
];

describe('экран «Пока тебя не было»', () => {
  it('не показывается, когда показывать нечего', () => {
    expect(worthShowing([])).toBe(false);
    expect(worthShowing([{ kind: 'dozed', hours: 100 }])).toBe(false);
    expect(worthShowing([{ kind: 'gathered', resource: 'wood', amount: 3 }])).toBe(false);
  });

  it('показывается, когда случилось что-то про людей или стройку', () => {
    expect(worthShowing([{ kind: 'built', buildingId: 'b1', typeId: 'hut' }])).toBe(true);
    expect(worthShowing([{ kind: 'settled', villagerId: 'villager-1', buildingId: 'b1' }])).toBe(
      true,
    );
    expect(worthShowing([{ kind: 'gathered', resource: 'wood', amount: 120 }])).toBe(true);
  });

  it('ставит людей выше стройки, а склад — последним', () => {
    const events: CatchUpEvent[] = [
      { kind: 'gathered', resource: 'wood', amount: 40 },
      { kind: 'built', buildingId: 'b1', typeId: 'hut' },
      { kind: 'settled', villagerId: 'villager-1', buildingId: 'b1' },
    ];

    const cards = welcomeCards(events, names, 1);
    expect(cards.map((card) => card.kind)).toEqual(['settled', 'built', 'gathered']);
    expect(cards[0]?.title).toContain('Мира');
  });

  it('карточек не больше шести', () => {
    const events: CatchUpEvent[] = Array.from({ length: 12 }, (_, i) => ({
      kind: 'settled' as const,
      villagerId: `villager-${String(i)}`,
      buildingId: `b${String(i)}`,
    }));

    expect(welcomeCards(events, names, 3)).toHaveLength(MAX_CARDS);
  });

  it('никогда не говорит о потерях и не подгоняет вернуться', () => {
    const everything: CatchUpEvent[] = [
      { kind: 'built', buildingId: 'b1', typeId: 'hut' },
      { kind: 'built', buildingId: 'b2', typeId: 'sawmill' },
      { kind: 'settled', villagerId: 'villager-1', buildingId: 'b1' },
      { kind: 'hired', villagerId: 'villager-2', buildingId: 'b2' },
      { kind: 'gathered', resource: 'wood', amount: 180 },
      { kind: 'storage_full', resource: 'wood' },
      { kind: 'dozed', hours: 150 },
    ];

    for (let seed = 0; seed < 12; seed += 1) {
      const text = welcomeCards(everything, names, seed)
        .map((card) => `${card.title} ${card.note ?? ''}`)
        .join(' ')
        .toLowerCase();

      for (const word of FORBIDDEN) expect(text).not.toContain(word);
    }
  });

  it('не ставит имя после предлога: имена склоняются', () => {
    // «У Сева появился угол» — та же беда, что и с родом: имя после предлога требует
    // падежа, которого шаблон не знает. Имя всегда подлежащее.
    const afterPreposition = /\b(у|к|для|с|со|о|об|при|от|до|на|про|над|под|за)\s+\{name\}/iu;

    for (const [group, lines] of Object.entries(WELCOME_TEMPLATES)) {
      for (const line of lines) {
        expect(line, `${group}: ${line}`).not.toMatch(afterPreposition);
      }
    }
  });

  it('не ставит глагол прошедшего времени сразу после имени', () => {
    // Имена в игре разного рода и без пометок (§5 ТЗ), поэтому «Мира переехал» неизбежно,
    // как только за именем окажется глагол в прошедшем. Про вещи так писать можно —
    // «у {name} появилась работа» согласуется с работой, а не с человеком.
    const gendered = /\{name\}\s+\S*(л|ла|ло|лся|лась)\b/u;

    for (const [group, lines] of Object.entries(WELCOME_TEMPLATES)) {
      for (const line of lines) {
        expect(line, `${group}: ${line}`).not.toMatch(gendered);
      }
    }
  });

  it('полный склад объясняет, что ничего не пропало', () => {
    const cards = welcomeCards(
      [
        { kind: 'settled', villagerId: 'villager-1', buildingId: 'b1' },
        { kind: 'storage_full', resource: 'wood' },
      ],
      names,
      2,
    );

    const full = cards.find((card) => card.note !== undefined);
    expect(full?.note).toContain('Всё на месте');
  });

  it('пустоватое возвращение закрывается спокойной карточкой', () => {
    const cards = welcomeCards([{ kind: 'built', buildingId: 'b1', typeId: 'hut' }], names, 5);
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.at(-1)?.kind).toBe('calm');
  });
});
