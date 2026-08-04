import { describe, expect, it } from 'vitest';

import { Material, MATERIAL_COUNT } from '../voxels';
import { materialColor, materialColorTable, Palette } from './palette';

describe('палитра', () => {
  it('содержит все семь тонов из §8 ТЗ', () => {
    expect(Palette).toEqual({
      seaDeep: 0x0e4f63,
      seaShallow: 0x3fa9a2,
      sand: 0xead9b0,
      leaf: 0x6e9e52,
      leafShade: 0x3d6440,
      lamp: 0xf2c14e,
      bloom: 0xc2547e,
    });
  });

  it('у каждого материала есть свой цвет', () => {
    // Розовая заглушка 0xff00ff означает, что материал забыли — на острове это заметно сразу.
    for (const material of Object.values(Material)) {
      expect(materialColor(material)).not.toBe(0xff00ff);
    }
  });

  it('цвета лежат в диапазоне RGB', () => {
    for (const material of Object.values(Material)) {
      const color = materialColor(material);
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('таблица цветов имеет нужный размер и нормирована к [0, 1]', () => {
    const table = materialColorTable();
    expect(table).toHaveLength(MATERIAL_COUNT * 3);
    for (const channel of table) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });

  it('таблица совпадает с поштучными цветами', () => {
    const table = materialColorTable();
    const grass = materialColor(Material.GRASS);
    expect(table[Material.GRASS * 3]).toBeCloseTo(((grass >> 16) & 0xff) / 255, 6);
    expect(table[Material.GRASS * 3 + 1]).toBeCloseTo(((grass >> 8) & 0xff) / 255, 6);
    expect(table[Material.GRASS * 3 + 2]).toBeCloseTo((grass & 0xff) / 255, 6);
  });
});
