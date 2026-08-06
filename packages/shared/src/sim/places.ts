import { columnIndex, WORLD_X, WORLD_Z } from '../voxels';
import type { Vec3 } from '../types';
import type { IslandShape } from '../worldgen/shape';
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
export function findSpawns(grid: NavGrid, count = 4, near?: Vec3): Vec3[] {
  const spawns: Vec3[] = [];
  const originX = near?.x ?? WORLD_X / 2;
  const originZ = near?.z ?? WORLD_Z / 2;

  for (let radius = 0; radius < 80 && spawns.length < count; radius += 2) {
    for (let angle = 0; angle < 16 && spawns.length < count; angle += 1) {
      const x = Math.round(originX + Math.cos((angle / 16) * Math.PI * 2) * radius);
      const z = Math.round(originZ + Math.sin((angle / 16) * Math.PI * 2) * radius);
      if (!isWalkable(grid, x, z)) continue;
      if (spawns.some((spawn) => Math.hypot(spawn.x - x, spawn.z - z) < 3)) continue;

      spawns.push({ x, y: (grid.height[columnIndex(x, z)] ?? 0) + 1, z });
    }
  }

  return spawns;
}

/**
 * Место высадки (§11 ТЗ, «первые 60 секунд»).
 *
 * Считается здесь, а не в сцене, по одной причине: жители появляются на сервере, а лодка
 * причаливает на клиенте, и разъехаться им нельзя. Одна чистая функция на обоих — и лодка
 * приходит ровно туда, где стоят четверо.
 *
 * Ничего случайного: место целиком определяется рельефом, то есть сидом острова.
 */
export interface LandingSite {
  /** Куда сходят на берег: проходимая клетка у самой воды в бухте. */
  shore: Vec3;
  /** Где стоит лодка: вода в шаге от берега. */
  moor: Vec3;
  /** Откуда лодка приходит: открытое море за бухтой. */
  offing: Vec3;
  /** Ровная площадка рядом с берегом — там встанет первый шалаш. */
  hut: Vec3;
}

/** Сколько клеток от бухты имеет смысл осматривать. Дальше это уже не «сошли на берег». */
const LANDING_SEARCH = 26;

/** Сторона площадки под первый шалаш. Совпадает с его следом. */
const HUT_SIDE = 2;

export function findLandingSite(grid: NavGrid, shape: IslandShape): LandingSite {
  const shore = findShore(grid, shape);
  const height = (point: Vec3): number => (grid.height[columnIndex(point.x, point.z)] ?? 0) + 1;

  // Направление «в море» — от берега к середине бухты. Лодка приходит по этой прямой.
  const dx = shape.bay.x - shore.x;
  const dz = shape.bay.z - shore.z;
  const length = Math.max(Math.hypot(dx, dz), 0.001);
  const seaward = { x: dx / length, z: dz / length };

  return {
    shore,
    // Лодка стоит на воде, а не «где-то в трёх клетках»: точка ищется по карте суши.
    moor: afloat(shape, shore, seaward, 2, 8),
    offing: afloat(shape, shore, seaward, 26, 40),
    hut: findHutSpot(grid, shore, seaward, height),
  };
}

/** Первая вода на луче от берега в море. Луч упирается в бухту, а бухта соединена с морем. */
function afloat(
  shape: IslandShape,
  shore: Vec3,
  seaward: { x: number; z: number },
  from: number,
  to: number,
): Vec3 {
  let last: Vec3 = { x: shore.x, y: shore.y, z: shore.z };

  for (let step = from; step <= to; step += 1) {
    const x = Math.round(shore.x + seaward.x * step);
    const z = Math.round(shore.z + seaward.z * step);
    if (x < 0 || z < 0 || x >= WORLD_X || z >= WORLD_Z) break;

    last = { x, y: shore.y, z };
    if (shape.land[columnIndex(x, z)] === 0) return last;
  }

  return last;
}

/** Ближайшая к бухте проходимая клетка, у которой сосед — вода: это и есть берег. */
function findShore(grid: NavGrid, shape: IslandShape): Vec3 {
  const centerX = Math.round(shape.bay.x);
  const centerZ = Math.round(shape.bay.z);
  let fallback: Vec3 | null = null;

  for (let radius = 0; radius < LANDING_SEARCH; radius += 1) {
    for (let angle = 0; angle < 48; angle += 1) {
      const x = Math.round(centerX + Math.cos((angle / 48) * Math.PI * 2) * radius);
      const z = Math.round(centerZ + Math.sin((angle / 48) * Math.PI * 2) * radius);
      if (x < 1 || z < 1 || x >= WORLD_X - 1 || z >= WORLD_Z - 1) continue;
      if (!isWalkable(grid, x, z)) continue;

      const point: Vec3 = { x, y: (grid.height[columnIndex(x, z)] ?? 0) + 1, z };
      fallback ??= point;

      // Именно вода, а не просто «непроходимо»: обрыв берегом не считается, к нему не причалить.
      const atWater =
        shape.land[columnIndex(x + 1, z)] === 0 ||
        shape.land[columnIndex(x - 1, z)] === 0 ||
        shape.land[columnIndex(x, z + 1)] === 0 ||
        shape.land[columnIndex(x, z - 1)] === 0;
      if (atWater) return point;
    }
  }

  return fallback ?? { x: Math.round(WORLD_X / 2), y: 1, z: Math.round(WORLD_Z / 2) };
}

/**
 * Площадка под первый шалаш: ровная, свободная и в двух шагах от берега — так, чтобы
 * подсказка попадала в кадр вместе с лодкой, а не пряталась за холмом.
 */
function findHutSpot(
  grid: NavGrid,
  shore: Vec3,
  seaward: { x: number; z: number },
  height: (point: Vec3) => number,
): Vec3 {
  // Идём от воды вглубь острова: у самой кромки шалаш стоял бы ногами в прибое.
  const inland = { x: -seaward.x, z: -seaward.z };

  for (let step = 2; step < LANDING_SEARCH; step += 1) {
    for (let side = -4; side <= 4; side += 1) {
      const x = Math.round(shore.x + inland.x * step - inland.z * side);
      const z = Math.round(shore.z + inland.z * step + inland.x * side);
      if (!isFlatPatch(grid, x, z)) continue;
      return { x, y: height({ x, y: 0, z }), z };
    }
  }

  return { x: shore.x, y: shore.y, z: shore.z };
}

/** Ровно ли место под здание со стороной `HUT_SIDE`: перепад не больше вокселя, всё проходимо. */
function isFlatPatch(grid: NavGrid, x: number, z: number): boolean {
  let lowest = Infinity;
  let highest = -Infinity;

  for (let dz = 0; dz < HUT_SIDE; dz += 1) {
    for (let dx = 0; dx < HUT_SIDE; dx += 1) {
      if (!isWalkable(grid, x + dx, z + dz)) return false;
      const surface = grid.height[columnIndex(x + dx, z + dz)] ?? -1;
      lowest = Math.min(lowest, surface);
      highest = Math.max(highest, surface);
    }
  }

  return highest - lowest <= 1;
}
