import type { Vec3 } from '../types';
import {
  columnIndex,
  isSolid,
  Material,
  WORLD_COLUMN_COUNT,
  WORLD_X,
  WORLD_Y,
  WORLD_Z,
} from '../voxels';
import type { WorldReader } from './world';

/**
 * Навигация по острову (§5 ТЗ).
 *
 * Граф строится из проходимых поверхностных вокселей: верхний твёрдый воксель, над которым
 * два воздушных, а перепад с соседом не больше единицы. Столбец даёт ровно одну проходимую
 * высоту, поэтому граф двумерный — а значит, помещается в пару типизированных массивов
 * и перестраивается кусками.
 */

export interface NavGrid {
  /** Высота проходимого вокселя в столбце; -1 — пройти нельзя. */
  height: Int16Array;
  /** Стоимость шага в эту клетку. Дорога вдвое дешевле травы. */
  cost: Float32Array;
}

/** Наибольший перепад, который житель перешагивает (§5 ТЗ). */
const MAX_STEP = 1;

/** Дороги снижают стоимость перехода вдвое — единственная мягкая оптимизация в игре (§5 ТЗ). */
const PATH_COST = 0.5;
const PLAIN_COST = 1;

export function createNavGrid(): NavGrid {
  return {
    height: new Int16Array(WORLD_COLUMN_COUNT).fill(-1),
    cost: new Float32Array(WORLD_COLUMN_COUNT).fill(PLAIN_COST),
  };
}

export function buildNavGrid(world: WorldReader): NavGrid {
  const grid = createNavGrid();
  rebuildNavArea(grid, world, 0, 0, WORLD_X - 1, WORLD_Z - 1);
  return grid;
}

/**
 * Перестраивает прямоугольный кусок графа. Правка мира трогает несколько клеток,
 * и перебирать из-за них весь остров незачем.
 */
export function rebuildNavArea(
  grid: NavGrid,
  world: WorldReader,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): void {
  const x0 = Math.max(0, fromX);
  const z0 = Math.max(0, fromZ);
  const x1 = Math.min(WORLD_X - 1, toX);
  const z1 = Math.min(WORLD_Z - 1, toZ);

  for (let z = z0; z <= z1; z += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = columnIndex(x, z);
      const surface = walkableHeight(world, x, z);
      grid.height[index] = surface;
      grid.cost[index] =
        surface >= 0 && world.material(x, surface, z) === Material.PATH ? PATH_COST : PLAIN_COST;
    }
  }
}

/**
 * Высота, по которой можно идти, или -1.
 *
 * Над головой требуется именно воздух, а не просто «не твёрдое». Вода не твёрдая, и по
 * ослабленной проверке дно моря выходило проходимым: жители спокойно уходили под воду.
 */
function walkableHeight(world: WorldReader, x: number, z: number): number {
  for (let y = WORLD_Y - 3; y >= 0; y -= 1) {
    const here = world.material(x, y, z);
    if (!isSolid(here)) continue;
    if (world.material(x, y + 1, z) !== Material.AIR) return -1;
    if (world.material(x, y + 2, z) !== Material.AIR) return -1;
    return y;
  }
  return -1;
}

export function isWalkable(grid: NavGrid, x: number, z: number): boolean {
  if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) return false;
  return (grid.height[columnIndex(x, z)] ?? -1) >= 0;
}

/** Можно ли шагнуть из клетки в соседнюю: обе проходимы и перепад не больше одного. */
export function canStep(grid: NavGrid, fromIndex: number, toIndex: number): boolean {
  const from = grid.height[fromIndex] ?? -1;
  const to = grid.height[toIndex] ?? -1;
  if (from < 0 || to < 0) return false;
  return Math.abs(from - to) <= MAX_STEP;
}

/**
 * Поиск пути A\*. Возвращает клетки от старта до цели включительно или `null`,
 * если дойти нельзя. Исполняется в воркере — главный поток не блокируется (§12 ТЗ).
 */
export function findPath(
  grid: NavGrid,
  from: { x: number; z: number },
  to: { x: number; z: number },
): Vec3[] | null {
  if (!isWalkable(grid, from.x, from.z) || !isWalkable(grid, to.x, to.z)) return null;

  const start = columnIndex(from.x, from.z);
  const goal = columnIndex(to.x, to.z);
  if (start === goal) return [cellToVec(grid, start)];

  const cameFrom = new Int32Array(WORLD_COLUMN_COUNT).fill(-1);
  const gScore = new Float32Array(WORLD_COLUMN_COUNT).fill(Infinity);
  const closed = new Uint8Array(WORLD_COLUMN_COUNT);

  gScore[start] = 0;
  const open = new MinHeap();
  open.push(start, heuristic(start, goal));

  while (open.size > 0) {
    const current = open.pop();
    if (current === goal) return reconstruct(grid, cameFrom, goal);
    if (closed[current] === 1) continue;
    closed[current] = 1;

    const x = current % WORLD_X;
    const base = gScore[current] ?? Infinity;

    const consider = (neighbour: number): void => {
      if (closed[neighbour] === 1 || !canStep(grid, current, neighbour)) return;
      const tentative = base + (grid.cost[neighbour] ?? PLAIN_COST);
      if (tentative >= (gScore[neighbour] ?? Infinity)) return;
      cameFrom[neighbour] = current;
      gScore[neighbour] = tentative;
      open.push(neighbour, tentative + heuristic(neighbour, goal));
    };

    if (x > 0) consider(current - 1);
    if (x < WORLD_X - 1) consider(current + 1);
    if (current >= WORLD_X) consider(current - WORLD_X);
    if (current + WORLD_X < WORLD_COLUMN_COUNT) consider(current + WORLD_X);
  }

  return null;
}

/**
 * Поле направлений к одной цели (§5 ТЗ). Для общего очага или склада, куда ходят все,
 * дешевле посчитать одно поле, чем гонять A\* для каждого жителя.
 */
export function buildFlowField(grid: NavGrid, to: { x: number; z: number }): Int32Array {
  const next = new Int32Array(WORLD_COLUMN_COUNT).fill(-1);
  if (!isWalkable(grid, to.x, to.z)) return next;

  const goal = columnIndex(to.x, to.z);
  const distance = new Float32Array(WORLD_COLUMN_COUNT).fill(Infinity);
  distance[goal] = 0;

  const open = new MinHeap();
  open.push(goal, 0);

  while (open.size > 0) {
    const current = open.pop();
    const base = distance[current] ?? Infinity;
    const x = current % WORLD_X;

    const consider = (neighbour: number): void => {
      if (!canStep(grid, current, neighbour)) return;
      const tentative = base + (grid.cost[current] ?? PLAIN_COST);
      if (tentative >= (distance[neighbour] ?? Infinity)) return;
      distance[neighbour] = tentative;
      // Поле строится от цели наружу, поэтому «следующий шаг» — это откуда мы пришли.
      next[neighbour] = current;
      open.push(neighbour, tentative);
    };

    if (x > 0) consider(current - 1);
    if (x < WORLD_X - 1) consider(current + 1);
    if (current >= WORLD_X) consider(current - WORLD_X);
    if (current + WORLD_X < WORLD_COLUMN_COUNT) consider(current + WORLD_X);
  }

  return next;
}

export function followFlowField(grid: NavGrid, field: Int32Array, from: Vec3): Vec3[] | null {
  let current = columnIndex(from.x, from.z);
  if ((field[current] ?? -1) === -1) return null;

  const path: Vec3[] = [cellToVec(grid, current)];
  // Потолок на длину: испорченное поле не должно уводить в бесконечный цикл.
  for (let step = 0; step < WORLD_X * 2; step += 1) {
    const nextCell = field[current] ?? -1;
    if (nextCell === -1) return path;
    path.push(cellToVec(grid, nextCell));
    current = nextCell;
  }
  return path;
}

function heuristic(from: number, to: number): number {
  const fx = from % WORLD_X;
  const fz = (from - fx) / WORLD_X;
  const tx = to % WORLD_X;
  const tz = (to - tx) / WORLD_X;
  // Манхэттен: ходим по четырём направлениям, диагоналей нет.
  return Math.abs(fx - tx) + Math.abs(fz - tz);
}

function cellToVec(grid: NavGrid, index: number): Vec3 {
  const x = index % WORLD_X;
  const z = (index - x) / WORLD_X;
  return { x, y: (grid.height[index] ?? 0) + 1, z };
}

function reconstruct(grid: NavGrid, cameFrom: Int32Array, goal: number): Vec3[] {
  const path: Vec3[] = [];
  let current = goal;
  while (current !== -1) {
    path.push(cellToVec(grid, current));
    current = cameFrom[current] ?? -1;
  }
  return path.reverse();
}

/**
 * Двоичная куча на типизированных массивах.
 *
 * Обычная сортировка списка открытых клеток на карте 160×160 съедает больше времени,
 * чем сам поиск, и делает бюджет в пять путей за тик недостижимым.
 */
class MinHeap {
  private readonly items = new Int32Array(WORLD_COLUMN_COUNT * 4);
  private readonly keys = new Float32Array(WORLD_COLUMN_COUNT * 4);
  private count = 0;

  get size(): number {
    return this.count;
  }

  push(item: number, key: number): void {
    if (this.count >= this.items.length) return;

    let index = this.count;
    this.count += 1;
    this.items[index] = item;
    this.keys[index] = key;

    while (index > 0) {
      const parent = (index - 1) >> 1;
      if ((this.keys[parent] ?? 0) <= (this.keys[index] ?? 0)) break;
      this.swap(parent, index);
      index = parent;
    }
  }

  pop(): number {
    const top = this.items[0] ?? -1;
    this.count -= 1;
    this.items[0] = this.items[this.count] ?? 0;
    this.keys[0] = this.keys[this.count] ?? 0;

    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.count && (this.keys[left] ?? 0) < (this.keys[smallest] ?? 0)) smallest = left;
      if (right < this.count && (this.keys[right] ?? 0) < (this.keys[smallest] ?? 0)) {
        smallest = right;
      }
      if (smallest === index) break;
      this.swap(smallest, index);
      index = smallest;
    }

    return top;
  }

  private swap(a: number, b: number): void {
    const item = this.items[a] ?? 0;
    const key = this.keys[a] ?? 0;
    this.items[a] = this.items[b] ?? 0;
    this.keys[a] = this.keys[b] ?? 0;
    this.items[b] = item;
    this.keys[b] = key;
  }
}
