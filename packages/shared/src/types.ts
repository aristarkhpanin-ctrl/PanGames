/**
 * Ключевые типы «Гавани» (§9 ТЗ).
 *
 * Форма мира задаётся целиком сразу, хотя наполняется по этапам: часть полей пока никто
 * не читает, и это нормально. Так проще не переделывать хранилище на каждом шаге.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// --- Ресурсы (§4 ТЗ) -------------------------------------------------------

export type BaseResourceId =
  'wood' | 'stone' | 'clay' | 'sand' | 'fiber' | 'fish' | 'fruit' | 'grain' | 'wool';

export type CraftedResourceId = 'plank' | 'brick' | 'glass' | 'cloth' | 'bread' | 'tool' | 'meal';

/** Мягкие ресурсы: ракушки — валюта, вдохновение — валюта уюта. */
export type SoftResourceId = 'shell' | 'inspiration';

export type ResourceId = BaseResourceId | CraftedResourceId | SoftResourceId;

// --- Жители (§5 ТЗ) --------------------------------------------------------

/** Ровно 12 черт характера; житель получает ровно две. */
export type TraitId =
  | 'early_bird'
  | 'night_owl'
  | 'hard_worker'
  | 'dreamer'
  | 'gardener'
  | 'fisher'
  | 'homebody'
  | 'wanderer'
  | 'cheerful'
  | 'quiet'
  | 'tidy'
  | 'collector';

export type AgentState =
  | 'idle'
  | 'walk'
  | 'work'
  | 'eat'
  | 'sleep'
  | 'socialize'
  | 'wander'
  | 'admire'
  | 'build'
  | 'haul'
  | 'celebrate';

export interface Needs {
  food: number;
  rest: number;
  shelter: number;
  social: number;
  beauty: number;
  purpose: number;
}

export interface Bond {
  withId: string;
  /** 0 — знакомы, 1 — приятели, 2 — друзья, 3 — близкие. */
  level: 0 | 1 | 2 | 3;
  points: number;
}

/** Виды желаний. Набор расширяется на M7.2 — сейчас это заготовка формы. */
export type WishKind = 'bench_at_favorite_spot' | 'building_nearby' | 'plant_nearby' | 'more_light';

export interface Wish {
  kind: WishKind;
  targetId?: string;
  createdAt: number;
}

export interface Villager {
  id: string;
  islandId: string;
  name: string;
  nickname?: string;
  /** Внешность выводится отсюда, а не хранится по полям. */
  seed: number;
  traits: [TraitId, TraitId];
  needs: Needs;
  /** 20..100. Пол жёсткий: ниже 20 не опускается никогда (устав). */
  mood: number;
  homeId?: string;
  jobId?: string;
  favoriteSpot?: Vec3;
  state: AgentState;
  target?: Vec3;
  path?: Vec3[];
  bonds: Bond[];
  wish?: Wish;
}

// --- Здания (§6 ТЗ) --------------------------------------------------------

/** Идентификатор из каталога зданий. Сужается до ключей каталога на M4.1. */
export type BuildingTypeId = string;

/** Идентификатор из каталога растений. Сужается до ключей каталога на M2.4. */
export type PlantId = string;

export type PausedReason = 'storage_full' | 'no_input' | 'no_worker';

export interface Building {
  id: string;
  islandId: string;
  typeId: BuildingTypeId;
  pos: Vec3;
  rotation: 0 | 1 | 2 | 3;
  level: 1 | 2 | 3;
  workers: string[];
  /** 0..1 — прогресс стройки. */
  progress: number;
  pausedReason?: PausedReason;
}

// --- Остров (§9 ТЗ) --------------------------------------------------------

export type Chapter = 1 | 2 | 3 | 4 | 5;

export interface Island {
  id: string;
  ownerId: string;
  name: string;
  seed: number;
  chapter: Chapter;
  createdAt: number;
  /** Серверное время последнего расчёта. Только сервер имеет право это менять. */
  lastTickAt: number;
  resources: Record<ResourceId, number>;
  storageCap: number;
  /** Короткий код для гостей. */
  visitCode: string;
}

export interface VoxelEdit {
  /** Индекс вокселя внутри чанка. */
  i: number;
  mat: number;
}

/**
 * Отличия мира от процедурной генерации. Хранится только разница — так остров весит
 * килобайты, а не мегабайты (§9 ТЗ).
 */
export interface WorldPatch {
  chunk: number;
  edits: VoxelEdit[];
}
