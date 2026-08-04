import type { PlantInstance, WorldPatch } from '@gavan/shared';

import type { LiveWorld } from './liveWorld';

/**
 * TEMPORARY: заменяется сервером на M5.3.
 *
 * До появления сервера правки хранятся в браузере, чтобы перезагрузка страницы не теряла
 * работу. Формат тот же, что уйдёт в базу: разница с генерацией плюс список растений (§9 ТЗ),
 * поэтому переход будет заменой места хранения, а не переписыванием.
 */

const KEY = 'gavan:world';

interface SavedWorld {
  version: number;
  seed: number;
  patches: WorldPatch[];
  plants: PlantInstance[];
}

const VERSION = 1;

export function saveWorld(world: LiveWorld): void {
  const payload: SavedWorld = {
    version: VERSION,
    seed: world.state.seed,
    patches: world.patches(),
    plants: [...world.state.plants],
  };

  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Переполненное или отключённое хранилище — не повод ронять игру.
  }
}

export function loadWorld(seed: number): { patches: WorldPatch[]; plants: PlantInstance[] } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const saved = parsed as Partial<SavedWorld>;
    // Чужой остров и старый формат просто игнорируем: чинить нечего, мир восстановится из сида.
    if (saved.version !== VERSION || saved.seed !== seed) return null;

    return { patches: saved.patches ?? [], plants: saved.plants ?? [] };
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
