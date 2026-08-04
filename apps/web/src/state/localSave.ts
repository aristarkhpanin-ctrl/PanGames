import type { PlacedBuilding, PlantInstance, ResourceId, WorldPatch } from '@gavan/shared';

import type { LiveWorld } from './liveWorld';

/**
 * TEMPORARY: заменяется сервером на M5.3.
 *
 * До появления сервера мир хранится в браузере, чтобы перезагрузка страницы ничего не теряла:
 * построенное остаётся навсегда (устав, п. 2), и это касается и закрытой вкладки. Формат тот же,
 * что уйдёт в базу: разница с генерацией, растения, здания и склад (§9 ТЗ), — поэтому переход
 * будет заменой места хранения, а не переписыванием.
 */

const KEY = 'gavan:world';

export interface SavedWorld {
  version: number;
  seed: number;
  patches: WorldPatch[];
  plants: PlantInstance[];
  buildings: PlacedBuilding[];
  resources: Record<ResourceId, number>;
  /** Остаток в залежах, отличающийся от исходного. */
  nodes: [string, number][];
  tick: number;
}

/** Версия 2 — вместе со зданиями и складом (M4). Прежние сохранения не читаются. */
const VERSION = 2;

export function saveWorld(world: LiveWorld, tick: number): void {
  const payload: SavedWorld = {
    version: VERSION,
    seed: world.state.seed,
    patches: world.patches(),
    plants: [...world.state.plants],
    buildings: world.state.buildings.map((building) => ({ ...building })),
    resources: { ...world.state.resources },
    nodes: [...world.state.nodes.entries()],
    tick,
  };

  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Переполненное или отключённое хранилище — не повод ронять игру.
  }
}

export function loadWorld(seed: number): SavedWorld | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const saved = parsed as Partial<SavedWorld>;
    // Чужой остров и старый формат просто игнорируем: чинить нечего, мир восстановится из сида.
    if (saved.version !== VERSION || saved.seed !== seed) return null;

    return {
      version: VERSION,
      seed,
      patches: saved.patches ?? [],
      plants: saved.plants ?? [],
      buildings: saved.buildings ?? [],
      resources: saved.resources ?? ({} as Record<ResourceId, number>),
      nodes: saved.nodes ?? [],
      tick: saved.tick ?? 0,
    };
  } catch {
    return null;
  }
}

export function clearWorld(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // См. выше.
  }
}
