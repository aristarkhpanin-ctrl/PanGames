/**
 * Размеры мира и материалы вокселей.
 *
 * Числовые значения материалов фиксируются навсегда: они попадают в сохранённые миры
 * (`world_patch`), и менять их задним числом значит испортить чужие острова.
 * Новые материалы добавляются только в конец списка.
 */

// --- Размеры (§2 ТЗ) -------------------------------------------------------

/** Сторона вокселя в метрах. */
export const VOXEL_SIZE = 0.5;

export const WORLD_X = 160;
export const WORLD_Y = 96;
export const WORLD_Z = 160;

/** Уровень моря: воксели ниже него под водой. */
export const SEA_LEVEL = 32;

/** Потолок суши над уровнем моря. */
export const MAX_LAND_HEIGHT = 24;

export const CHUNK_X = 32;
export const CHUNK_Y = WORLD_Y;
export const CHUNK_Z = 32;

export const CHUNKS_X = WORLD_X / CHUNK_X;
export const CHUNKS_Z = WORLD_Z / CHUNK_Z;
export const CHUNK_COUNT = CHUNKS_X * CHUNKS_Z;

export const WORLD_VOXEL_COUNT = WORLD_X * WORLD_Y * WORLD_Z;

/** Столбец — вертикаль мира в точке (x, z). Карты высот и биомов адресуются так. */
export const WORLD_COLUMN_COUNT = WORLD_X * WORLD_Z;

export function columnIndex(x: number, z: number): number {
  return x + WORLD_X * z;
}

// --- Материалы (§2.3 ТЗ) ---------------------------------------------------

export const Material = {
  AIR: 0,
  WATER: 1,
  SAND: 2,
  DIRT: 3,
  GRASS: 4,
  STONE: 5,
  CLAY: 6,
  WOOD: 7,
  LEAVES: 8,
  PATH: 9,
  PLANK: 10,
  BRICK: 11,
  GLASS: 12,
  THATCH: 13,
  FLOWER_WHITE: 14,
  FLOWER_PINK: 15,
  FLOWER_AMBER: 16,
} as const;

export type MaterialId = (typeof Material)[keyof typeof Material];

export const MATERIAL_COUNT = 17;

/** Материал занимает объём: по нему нельзя пройти насквозь. */
export function isSolid(material: number): boolean {
  return material !== Material.AIR && material !== Material.WATER;
}

/** Материал полностью перекрывает обзор — значит, соседние грани можно не рисовать. */
export function isOpaque(material: number): boolean {
  return isSolid(material) && material !== Material.GLASS && !isFlower(material);
}

/** Цветы рисуются вокселем, но не мешают ходить и не перекрывают обзор. */
export function isFlower(material: number): boolean {
  return (
    material === Material.FLOWER_WHITE ||
    material === Material.FLOWER_PINK ||
    material === Material.FLOWER_AMBER
  );
}

// --- Индексация ------------------------------------------------------------

/**
 * Порядок осей: x меняется быстрее всего, затем z, затем y.
 * Так проход по горизонтальному слою идёт подряд по памяти — а именно так работают
 * и мешинг, и построение навигационной сетки.
 */
export function voxelIndex(x: number, y: number, z: number): number {
  return x + WORLD_X * (z + WORLD_Z * y);
}

export function isInsideWorld(x: number, y: number, z: number): boolean {
  return x >= 0 && x < WORLD_X && y >= 0 && y < WORLD_Y && z >= 0 && z < WORLD_Z;
}

export function chunkIndex(chunkX: number, chunkZ: number): number {
  return chunkX + CHUNKS_X * chunkZ;
}

export function chunkOrigin(index: number): { x: number; z: number } {
  return { x: (index % CHUNKS_X) * CHUNK_X, z: Math.floor(index / CHUNKS_X) * CHUNK_Z };
}

/** Номер чанка, которому принадлежит воксель. */
export function chunkOfVoxel(x: number, z: number): number {
  return chunkIndex(Math.floor(x / CHUNK_X), Math.floor(z / CHUNK_Z));
}
