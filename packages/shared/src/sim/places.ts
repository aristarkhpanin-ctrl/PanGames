import { columnIndex, WORLD_X, WORLD_Z } from '../voxels';
import type { Vec3 } from '../types';
import { isWalkable, type NavGrid } from './navigation';

/**
 * Приметные места острова: куда сходят на берег и куда ходят любоваться (§5 ТЗ).
 *
 * Функции чистые и живут здесь, а не у клиента с сервером по копии: место, где начинается
 * жизнь острова, обязано быть одним и тем же у обоих — иначе жители разойдутся с первого тика.
 */

/** Сколько красивых мест ищем. Больше — и выбор перестаёт быть выбором. */
const SCENIC_LIMIT = 40;

/** Проходимые клетки у самой воды: там смотрят на море. */
export function findScenicSpots(grid: NavGrid): Vec3[] {
  const spots: Vec3[] = [];

  for (let z = 2; z < WORLD_Z - 2 && spots.length < SCENIC_LIMIT; z += 4) {
    for (let x = 2; x < WORLD_X - 2 && spots.length < SCENIC_LIMIT; x += 4) {
      if (!isWalkable(grid, x, z)) continue;

      // У воды: хотя бы один сосед непроходим — значит, там берег.
      const nearWater =
        !isWalkable(grid, x + 2, z) ||
        !isWalkable(grid, x - 2, z) ||
        !isWalkable(grid, x, z + 2) ||
        !isWalkable(grid, x, z - 2);
      if (!nearWater) continue;

      spots.push({ x, y: (grid.height[columnIndex(x, z)] ?? 0) + 1, z });
    }
  }

  return spots;
}

/** Проходимые клетки поближе к бухте: там причалила лодка. */
export function findSpawns(grid: NavGrid, count = 4): Vec3[] {
  const spawns: Vec3[] = [];

  for (let radius = 0; radius < 80 && spawns.length < count; radius += 2) {
    for (let angle = 0; angle < 16 && spawns.length < count; angle += 1) {
      const x = Math.round(WORLD_X / 2 + Math.cos((angle / 16) * Math.PI * 2) * radius);
      const z = Math.round(WORLD_Z / 2 + Math.sin((angle / 16) * Math.PI * 2) * radius);
      if (!isWalkable(grid, x, z)) continue;
      if (spawns.some((spawn) => Math.hypot(spawn.x - x, spawn.z - z) < 3)) continue;

      spawns.push({ x, y: (grid.height[columnIndex(x, z)] ?? 0) + 1, z });
    }
  }

  return spawns;
}
