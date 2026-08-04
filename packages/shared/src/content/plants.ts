import { Material } from '../voxels';

/**
 * Каталог растений — данные, не код (§ правила проекта). Новое растение это запись здесь,
 * без единой правки логики: и валидация, и отрисовка читают отсюда.
 */

export interface PlantKind {
  id: string;
  name: string;
  /** На чём растёт. */
  soil: readonly number[];
  /** Свободных клеток вокруг: цветы жмутся тесно, куст требует места. */
  spacing: number;
  /** Высота и ширина в метрах — по ним строится инстанс. */
  height: number;
  width: number;
  /** Цвет берётся через материал, то есть из палитры. */
  material: number;
  /** Есть ли тонкий стебель под шапкой. */
  stem: boolean;
}

const GROUND = [Material.GRASS, Material.DIRT, Material.SAND, Material.CLAY] as const;

export const PLANTS: readonly PlantKind[] = [
  {
    id: 'flower_pink',
    name: 'Розовые цветы',
    soil: GROUND,
    spacing: 0,
    height: 0.4,
    width: 0.35,
    material: Material.FLOWER_PINK,
    stem: true,
  },
  {
    id: 'flower_white',
    name: 'Белые цветы',
    soil: GROUND,
    spacing: 0,
    height: 0.4,
    width: 0.35,
    material: Material.FLOWER_WHITE,
    stem: true,
  },
  {
    id: 'flower_amber',
    name: 'Жёлтые цветы',
    soil: GROUND,
    spacing: 0,
    height: 0.45,
    width: 0.35,
    material: Material.FLOWER_AMBER,
    stem: true,
  },
  {
    id: 'tuft',
    name: 'Пучок травы',
    soil: [Material.GRASS, Material.DIRT],
    spacing: 0,
    height: 0.5,
    width: 0.5,
    material: Material.GRASS,
    stem: false,
  },
  {
    id: 'shrub',
    name: 'Куст',
    soil: [Material.GRASS, Material.DIRT],
    spacing: 1,
    height: 1.1,
    width: 1.2,
    material: Material.LEAVES,
    stem: false,
  },
];

const BY_ID = new Map(PLANTS.map((plant) => [plant.id, plant]));

export function plantKind(id: string): PlantKind | undefined {
  return BY_ID.get(id);
}
