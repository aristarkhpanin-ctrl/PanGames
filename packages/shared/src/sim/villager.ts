import { VILLAGER_NAMES } from '../content/names';
import { TRAITS } from '../content/traits';
import type { TraitId, Vec3, Villager } from '../types';
import { createRng, deriveSeed } from '../worldgen/rng';
import { fullNeeds, rawMood } from './needs';

/**
 * Создание жителя и его внешность (§5 ТЗ).
 *
 * Всё выводится из сида: имя, две черты, цвета, причёска, одежда. Хранить это по полям
 * незачем — и остров тогда весит меньше, и один сид всегда даёт того же человека.
 */

/** Цвета жителей. Как и всё остальное, только из палитры (§8 ТЗ). */
export const VILLAGER_COLORS = {
  skin: [0xe8c9a0, 0xd8a878, 0xb8825a, 0x8a5c3e, 0x6b452e],
  hair: [0x3a2a1e, 0x6b4a2e, 0x2b2b30, 0xa8763f, 0xd8c179, 0x8a9196],
  cloth: [0x6e9e52, 0x3fa9a2, 0xc2547e, 0xf2c14e, 0xead9b0, 0x3d6440, 0x0e4f63],
} as const;

export const HAIRSTYLE_COUNT = 4;
export const OUTFIT_COUNT = 5;

export interface VillagerLook {
  skin: number;
  hair: number;
  cloth: number;
  hairstyle: number;
  outfit: number;
  /** Небольшой разброс роста, чтобы четверо не выглядели одинаковыми. */
  height: number;
}

export function villagerLook(seed: number): VillagerLook {
  const rng = createRng(deriveSeed(seed, 'look'));
  return {
    skin: VILLAGER_COLORS.skin[rng.int(0, VILLAGER_COLORS.skin.length - 1)] ?? 0xe8c9a0,
    hair: VILLAGER_COLORS.hair[rng.int(0, VILLAGER_COLORS.hair.length - 1)] ?? 0x3a2a1e,
    cloth: VILLAGER_COLORS.cloth[rng.int(0, VILLAGER_COLORS.cloth.length - 1)] ?? 0x6e9e52,
    hairstyle: rng.int(0, HAIRSTYLE_COUNT - 1),
    outfit: rng.int(0, OUTFIT_COUNT - 1),
    height: rng.range(0.92, 1.08),
  };
}

/** Ровно две разные черты (§5 ТЗ). */
export function pickTraits(seed: number): [TraitId, TraitId] {
  const rng = createRng(deriveSeed(seed, 'traits'));
  const first = rng.int(0, TRAITS.length - 1);
  let second = rng.int(0, TRAITS.length - 2);
  if (second >= first) second += 1;

  return [TRAITS[first]?.id ?? 'dreamer', TRAITS[second]?.id ?? 'quiet'];
}

export function villagerName(seed: number, taken: readonly string[]): string {
  const rng = createRng(deriveSeed(seed, 'name'));
  const free = VILLAGER_NAMES.filter((name) => !taken.includes(name));
  const pool = free.length > 0 ? free : VILLAGER_NAMES;
  return pool[rng.int(0, pool.length - 1)] ?? 'Мира';
}

/**
 * Четверо, которые сошли на берег (§9 ТЗ: остров создаётся сразу с ними).
 * Места высадки приходят снаружи: они зависят от рельефа, а не от сида жителя.
 */
export function createStartingVillagers(
  islandSeed: number,
  islandId: string,
  spawns: readonly Vec3[],
): Villager[] {
  const villagers: Villager[] = [];

  for (let index = 0; index < 4; index += 1) {
    const seed = deriveSeed(islandSeed, `villager:${String(index)}`);
    const needs = fullNeeds();

    villagers.push({
      id: `villager-${String(index)}`,
      islandId,
      name: villagerName(
        seed,
        villagers.map((v) => v.name),
      ),
      seed,
      traits: pickTraits(seed),
      needs,
      mood: rawMood(needs),
      state: 'idle',
      position: spawns[index] ?? spawns[0] ?? { x: 0, y: 0, z: 0 },
      bonds: [],
    });
  }

  return villagers;
}
