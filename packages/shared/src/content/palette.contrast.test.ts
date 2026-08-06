import { describe, expect, it } from 'vitest';

import { Palette } from './palette';

/**
 * Контраст текста по WCAG AA (§8 ТЗ).
 *
 * Проверяется расчётом, а не на глаз: «вроде читается» на хорошем мониторе в тёмной комнате
 * не значит, что читается на ноутбуке у окна. Порог AA — 4.5 для обычного текста и 3.0
 * для крупного (от 24px или от 19px полужирного).
 */

const AA_TEXT = 4.5;
const AA_LARGE = 3;

/** Тёмная подложка панелей интерфейса. */
const PANEL = 0x0b1a2a;

/**
 * Панели полупрозрачны и лежат поверх сцены, поэтому считать контраст по самой подложке
 * нельзя: сквозь неё просвечивает остров. Худший случай — светлый песок, и именно на нём
 * текст обязан оставаться читаемым.
 */
const PANEL_ALPHA = 0.72;

function over(front: number, back: number, alpha: number): number {
  const mix = (shift: number): number =>
    Math.round((((front >> shift) & 0xff) * alpha + ((back >> shift) & 0xff) * (1 - alpha)) * 1) &
    0xff;
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

function luminance(hex: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const r = channel((hex >> 16) & 0xff);
  const g = channel((hex >> 8) & 0xff);
  const b = channel(hex & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

describe('контраст интерфейса', () => {
  /** Панель на самом светлом, что бывает под ней. */
  const onSand = over(PANEL, Palette.sand, PANEL_ALPHA);
  /** Панель на воде — второй по яркости фон. */
  const onSea = over(PANEL, Palette.seaShallow, PANEL_ALPHA);

  const pairs: [string, number, number, number][] = [
    ['песок на панели над песком', Palette.sand, onSand, AA_TEXT],
    ['песок на панели над водой', Palette.sand, onSea, AA_TEXT],
    ['лампа на панели над песком', Palette.lamp, onSand, AA_TEXT],
    ['тень листвы на песке', Palette.leafShade, Palette.sand, AA_TEXT],
  ];

  for (const [name, front, back, threshold] of pairs) {
    it(`${name} — не ниже ${String(threshold)}`, () => {
      expect(contrast(front, back)).toBeGreaterThanOrEqual(threshold);
    });
  }

  it('панель светлее 72% перестала бы держать AA — это и есть нижняя граница', () => {
    // Тот же расчёт с прежней непрозрачностью 58% давал 3.9 и провалил бы AA.
    // Тест стоит здесь, чтобы граница не сползла обратно при следующей правке стилей.
    expect(contrast(Palette.sand, over(PANEL, Palette.sand, 0.58))).toBeLessThan(AA_TEXT);
    expect(contrast(Palette.sand, over(PANEL, Palette.sand, PANEL_ALPHA))).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('лист на песке слишком слаб для текста и потому текстом не бывает', () => {
    // Явная фиксация того, что этой парой писать нельзя: зелёный по песку читается плохо,
    // и знать об этом лучше из теста, чем из жалобы.
    expect(contrast(Palette.leaf, Palette.sand)).toBeLessThan(AA_TEXT);
  });

  it('цветочный розовый не годится в текст ни при каком размере', () => {
    // 1.9 на панели — это не «мелковато», это нечитаемо. Поэтому `--bloom` живёт только
    // в сцене: цветы, отказ при постановке здания, одежда жителей. В стилях его нет.
    expect(contrast(Palette.bloom, onSand)).toBeLessThan(AA_LARGE);
  });
});
