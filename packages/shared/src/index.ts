/**
 * Общее ядро «Гавани»: типы, каталоги контента, генерация мира и симуляция.
 *
 * Этот пакет исполняется и на клиенте (предсказание), и на сервере (авторитетно),
 * поэтому всё внутри — чистые детерминированные функции: без three.js, DOM и Node API,
 * без обращений к текущему времени и без Math.random(). Время и случайность приходят
 * аргументами. Правила и причины — в CLAUDE.md.
 */

/** Версия формата сохранённого мира. Растёт, когда меняется структура снимка острова. */
export const WORLD_FORMAT_VERSION = 1;

export * from './types';
export * from './math';
export * from './voxels';
export * from './content/palette';
export * from './worldgen/rng';
export * from './worldgen/noise';
export * from './worldgen/shape';
export * from './worldgen/biomes';
export * from './worldgen/scatter';
export * from './worldgen/island';
export * from './mesh/greedy';
export * from './voxelRay';
export * from './commands';
export * from './content/plants';
export * from './sim/world';
export * from './sim/validate';
export * from './sim/apply';
