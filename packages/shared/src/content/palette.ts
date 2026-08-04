import { Material, MATERIAL_COUNT, type MaterialId } from '../voxels';

/**
 * Палитра «Гавани» (§8 ТЗ). Текстур в проекте нет вообще — только цвет вершины и мягкое AO,
 * поэтому палитра и есть весь визуальный материал игры.
 *
 * Направление — рассветный архипелаг: мягкий свет, десатурированная зелень, тёплый песок,
 * глубокая вода. Акцент — цвет тёплого лампового света, потому что вечернее освещение
 * и есть эмоциональная кульминация игры.
 */
export const Palette = {
  seaDeep: 0x0e4f63,
  seaShallow: 0x3fa9a2,
  sand: 0xead9b0,
  leaf: 0x6e9e52,
  leafShade: 0x3d6440,
  lamp: 0xf2c14e,
  bloom: 0xc2547e,
} as const;

/**
 * Цвета материалов. Всё, чего нет в палитре напрямую (земля, камень, глина, дерево),
 * выведено из её тонов, а не подобрано отдельно: так остров остаётся одним целым.
 */
const MATERIAL_COLOR: Record<MaterialId, number> = {
  [Material.AIR]: 0x000000,
  [Material.WATER]: Palette.seaDeep,
  [Material.SAND]: Palette.sand,
  [Material.DIRT]: 0x6b5741,
  [Material.GRASS]: Palette.leaf,
  [Material.STONE]: 0x8a9196,
  [Material.CLAY]: 0xb07a5e,
  [Material.WOOD]: 0x7a5c3e,
  [Material.LEAVES]: Palette.leafShade,
  [Material.PATH]: 0xc9b78c,
  [Material.PLANK]: 0xc4a26a,
  [Material.BRICK]: 0xa8593f,
  [Material.GLASS]: 0xcfe3e0,
  [Material.THATCH]: 0xd8c179,
  [Material.FLOWER_WHITE]: 0xf2ede0,
  [Material.FLOWER_PINK]: Palette.bloom,
  [Material.FLOWER_AMBER]: Palette.lamp,
};

/** Известные значения материалов — для проверки чисел, пришедших извне. */
const KNOWN_MATERIALS = new Set<number>(Object.values(Material));

export function materialColor(material: number): number {
  // Розовая заглушка вместо падения: забытый материал должен бросаться в глаза на острове,
  // а не ронять отрисовку целого чанка.
  if (!KNOWN_MATERIALS.has(material)) return 0xff00ff;
  // Приведение безопасно: набор выше собран из значений самого перечисления.
  return MATERIAL_COLOR[material as MaterialId];
}

/** Цвета всех материалов подряд — в таком виде их удобно отдавать в воркер мешинга. */
export function materialColorTable(): Float32Array {
  const table = new Float32Array(MATERIAL_COUNT * 3);
  for (let material = 0; material < MATERIAL_COUNT; material += 1) {
    const color = materialColor(material);
    table[material * 3] = ((color >> 16) & 0xff) / 255;
    table[material * 3 + 1] = ((color >> 8) & 0xff) / 255;
    table[material * 3 + 2] = (color & 0xff) / 255;
  }
  return table;
}
