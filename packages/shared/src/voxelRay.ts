import { isInsideWorld, WORLD_Y } from './voxels';

/**
 * Проход луча по воксельной сетке (алгоритм Амана́тидеса и Ву).
 *
 * Пикинг идёт по данным мира, а не по геометрии мешей: так он точен независимо от того,
 * как greedy meshing склеил грани, и не зависит от того, успел ли чанк перестроиться.
 */

export interface RayHit {
  /** Воксель, в который попал луч. */
  x: number;
  y: number;
  z: number;
  /** Нормаль грани, через которую луч вошёл: по ней ставится соседний воксель. */
  nx: number;
  ny: number;
  nz: number;
  distance: number;
}

/** Координаты и направление — в вокселях, не в метрах. */
export function raycastVoxels(
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistance: number,
  isSolid: (x: number, y: number, z: number) => boolean,
): RayHit | null {
  const length = Math.hypot(dirX, dirY, dirZ);
  if (length === 0) return null;

  const dx = dirX / length;
  const dy = dirY / length;
  const dz = dirZ / length;

  let x = Math.floor(originX);
  let y = Math.floor(originY);
  let z = Math.floor(originZ);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;

  // Бесконечность для осей, вдоль которых луч не движется, — штатный случай, а не ошибка.
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  const deltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);

  let maxX = dx === 0 ? Infinity : ((dx > 0 ? x + 1 - originX : originX - x) || 0) * deltaX;
  let maxY = dy === 0 ? Infinity : ((dy > 0 ? y + 1 - originY : originY - y) || 0) * deltaY;
  let maxZ = dz === 0 ? Infinity : ((dz > 0 ? z + 1 - originZ : originZ - z) || 0) * deltaZ;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let travelled = 0;

  // Шагов не больше, чем клеток на пути: защита от зацикливания при вырожденном направлении.
  const limit = Math.ceil(maxDistance * 3) + 3;

  for (let step = 0; step < limit; step += 1) {
    if (isInsideWorld(x, y, z) && isSolid(x, y, z)) {
      return { x, y, z, nx, ny, nz, distance: travelled };
    }

    if (maxX <= maxY && maxX <= maxZ) {
      travelled = maxX;
      x += stepX;
      maxX += deltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (maxY <= maxZ) {
      travelled = maxY;
      y += stepY;
      maxY += deltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      travelled = maxZ;
      z += stepZ;
      maxZ += deltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }

    if (travelled > maxDistance) return null;
    // Уйдя выше потолка мира вверх, луч уже не вернётся.
    if (y >= WORLD_Y && stepY > 0) return null;
    if (y < 0 && stepY < 0) return null;
  }

  return null;
}
