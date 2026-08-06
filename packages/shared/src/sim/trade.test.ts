import { describe, expect, it } from 'vitest';

import { GIFTS, POSTCARDS, giftKind, postcard } from '../content/postcards';
import { Material, voxelIndex } from '../voxels';
import { generateIsland } from '../worldgen/island';
import { applyCommand } from './apply';
import { ALL_RESOURCES, type PlacedBuilding } from './economy';
import { boatIsHere, costInShells, MAX_TRADE_AMOUNT, shellsForGiving, TRADABLE } from './trade';
import { commitEffect, createWorldState, type WorldReader } from './world';
import { validate } from './validate';

/**
 * Торговля существует ради одного: тупик по ресурсам должен быть невозможен (§4 ТЗ).
 * Поэтому главная проверка здесь — «кончилось всё», а не курс и не выгода.
 */

const SEED = 42;
const island = generateIsland(SEED);
const reader: WorldReader = {
  material: (x, y, z) => island.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
};

function harbor(): PlacedBuilding {
  return {
    id: 'harbor-1',
    typeId: 'harbor',
    x: 40,
    y: 20,
    z: 40,
    rotation: 0,
    level: 1,
    workers: [],
    residents: [],
    progress: 1,
    builtAtTick: 0,
  };
}

describe('торговля', () => {
  it('без порта не работает', () => {
    const state = createWorldState(SEED);
    expect(validate({ t: 'trade', take: { id: 'stone', amount: 5 } }, state, reader)).toEqual({
      ok: false,
      reason: 'needs_harbor',
    });
  });

  it('не даёт купить без ракушек', () => {
    const state = createWorldState(SEED);
    state.buildings.push(harbor());

    expect(validate({ t: 'trade', take: { id: 'stone', amount: 5 } }, state, reader)).toEqual({
      ok: false,
      reason: 'cannot_afford',
    });
  });

  it('меняет сданное на ракушки, а ракушки — на нужное', () => {
    const state = createWorldState(SEED);
    state.buildings.push(harbor());
    state.resources.wood = 40;

    commitEffect(
      state,
      applyCommand({ t: 'trade', give: { id: 'wood', amount: 40 } }, state, reader),
    );
    expect(state.resources.wood).toBe(0);
    expect(state.resources.shell).toBe(shellsForGiving(40));

    const affordable = Math.floor(state.resources.shell / costInShells('stone', 1));
    commitEffect(
      state,
      applyCommand({ t: 'trade', take: { id: 'stone', amount: affordable } }, state, reader),
    );
    expect(state.resources.stone).toBe(affordable);
  });

  it('не пускает мягкие ресурсы в трюм', () => {
    const state = createWorldState(SEED);
    state.buildings.push(harbor());
    state.resources.shell = 100;

    expect(validate({ t: 'trade', take: { id: 'inspiration', amount: 1 } }, state, reader)).toEqual(
      {
        ok: false,
        reason: 'not_tradable',
      },
    );
    expect(TRADABLE).not.toContain('inspiration');
    expect(TRADABLE).not.toContain('shell');
  });

  it('держит потолок на одну сделку', () => {
    const state = createWorldState(SEED);
    state.buildings.push(harbor());
    state.resources.shell = 10_000;

    expect(
      validate({ t: 'trade', take: { id: 'stone', amount: MAX_TRADE_AMOUNT + 1 } }, state, reader),
    ).toEqual({ ok: false, reason: 'too_much' });
  });

  it('кончилось всё — и это не тупик', () => {
    const state = createWorldState(SEED);
    state.buildings.push(harbor());
    for (const id of ALL_RESOURCES) state.resources[id] = 0;

    // Ракушки приходят от уюта просто за хорошую жизнь (§4 ТЗ) — это и есть страховка.
    state.resources.shell = 20;

    const verdict = validate({ t: 'trade', take: { id: 'wood', amount: 10 } }, state, reader);
    expect(verdict).toEqual({ ok: true });

    commitEffect(
      state,
      applyCommand({ t: 'trade', take: { id: 'wood', amount: 10 } }, state, reader),
    );
    expect(state.resources.wood).toBe(10);
    // С деревом снова можно строить: остров выбрался из пустоты, ничего не потеряв.
    expect(state.resources.shell).toBeGreaterThanOrEqual(0);
  });

  it('лодка приходит событием, а не по обратному отсчёту', () => {
    const buildings = [harbor()];
    expect(boatIsHere(0, buildings)).toBe(true);
    expect(boatIsHere(144, buildings)).toBe(true);
    expect(boatIsHere(50, buildings)).toBe(false);
    // Без порта лодке некуда причалить, сколько ни жди.
    expect(boatIsHere(144, [])).toBe(false);
  });
});

describe('открытки и подарки', () => {
  it('собираются только из готового набора', () => {
    expect(POSTCARDS.length).toBeGreaterThan(8);
    expect(postcard('was_here')).toBeDefined();
    expect(postcard('что-угодно-своё')).toBeUndefined();
    expect(giftKind('seeds')?.gives.grain).toBeGreaterThan(0);
    expect(giftKind('выдумка')).toBeUndefined();
  });

  it('ни одна открытка не оценивает и не сравнивает', () => {
    const forbidden = ['лучш', 'круче', 'хуже', 'красивее', 'рейтинг', 'место', 'оценк', '!'];

    for (const card of POSTCARDS) {
      const text = card.text.toLowerCase();
      for (const word of forbidden) {
        expect(text, card.id).not.toContain(word);
      }
    }
  });

  it('подарок состоит из настоящих ресурсов, а не из воздуха', () => {
    for (const gift of GIFTS) {
      const total = Object.values(gift.gives).reduce((sum, amount) => sum + amount, 0);
      expect(total, gift.id).toBeGreaterThan(0);
      for (const id of Object.keys(gift.gives)) {
        expect(ALL_RESOURCES).toContain(id);
      }
    }
  });
});
