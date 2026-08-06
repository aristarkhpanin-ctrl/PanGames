import { clamp, smoothstep } from '../math';
import { columnIndex, MAX_LAND_HEIGHT, WORLD_COLUMN_COUNT, WORLD_X, WORLD_Z } from '../voxels';
import { createNoise2D, fbm2 } from './noise';
import { createRng, deriveSeed } from './rng';

/**
 * Форма острова: где суша, какой она высоты и где какая глубина.
 *
 * Остров намеренно небольшой и не расширяется бесконечно — ограниченность часть замысла:
 * игрок обустраивает конкретное место, а не гонится за ростом (§2 ТЗ).
 */

export interface Bay {
  x: number;
  z: number;
  radius: number;
}

/**
 * Маленький островок в стороне от главного (§2 ТЗ, отложено до M10).
 *
 * Дойти до него по суше нельзя — между ним и берегом всегда есть вода. Игрок кладёт мостки
 * и получает ещё немного места; жители переходят по ним сами. Это не задача и не запертый
 * контент: не построишь мост — не произойдёт ровным счётом ничего.
 */
export interface Islet {
  x: number;
  z: number;
  radius: number;
}

export interface IslandShape {
  /** 1 — суша, 0 — вода. Индексация по столбцам. */
  land: Uint8Array;
  /** Высота суши над уровнем моря, 1..MAX_LAND_HEIGHT. Для воды — 0. */
  landHeight: Uint8Array;
  /** Глубина воды под уровнем моря, 1.. . Для суши — 0. */
  waterDepth: Uint8Array;
  /** Расстояние до ближайшей воды в клетках. Для воды — 0. */
  distToWater: Int16Array;
  /** Расстояние до ближайшей суши в клетках. Для суши — 0. */
  distToLand: Int16Array;
  /** 1 — вода соединена с открытым морем, 0 — внутренний пруд. */
  openSea: Uint8Array;
  bay: Bay;
  /** Направление на скалистый сектор в радианах. */
  rockAngle: number;
  landCells: number;
  /** Островки в стороне: до них нужно навести мостки. */
  islets: Islet[];
}

const CENTER_X = WORLD_X / 2;
const CENTER_Z = WORLD_Z / 2;
/** Радиус, за который остров не выходит: у края мира всегда остаётся вода. */
const ISLAND_RADIUS = 68;

/** Доля суши от площади мира. Подобрана так, чтобы полная застройка помещалась с запасом. */
const LAND_FRACTION = 0.34;

export function generateShape(seed: number): IslandShape {
  const coastNoise = createNoise2D(createRng(deriveSeed(seed, 'coast')));
  const heightNoise = createNoise2D(createRng(deriveSeed(seed, 'height')));
  const rng = createRng(deriveSeed(seed, 'shape')); // Бухта и скалы.

  // Бухта врезается в берег: центр близко к линии воды, чтобы получился залив, а не озеро.
  const bayAngle = rng.range(0, Math.PI * 2);
  const bayDistance = ISLAND_RADIUS * 0.66;
  const bay: Bay = {
    x: CENTER_X + Math.cos(bayAngle) * bayDistance,
    z: CENTER_Z + Math.sin(bayAngle) * bayDistance,
    radius: ISLAND_RADIUS * 0.26,
  };

  // Скалы только в одном секторе: остров должен читаться как «пляж, луг, лес, скала» (§2 ТЗ).
  // Отводим их подальше от бухты, чтобы у воды было где причалить.
  const rockAngle = bayAngle + Math.PI + rng.range(-0.6, 0.6);

  // Скала — вершина в конкретной точке, а не поднятый сектор. Сектор давал ровное плато
  // во всю ширину острова: серую площадку вместо утёса, который видно с моря.
  const peakDistance = ISLAND_RADIUS * rng.range(0.38, 0.5);
  const peak = {
    x: CENTER_X + Math.cos(rockAngle) * peakDistance,
    z: CENTER_Z + Math.sin(rockAngle) * peakDistance,
    radius: ISLAND_RADIUS * rng.range(0.26, 0.34),
  };

  const landValue = buildLandValue(coastNoise, bay);
  const land = thresholdToTargetArea(landValue);
  keepLargestLandmass(land);

  // Островки сажаются после отсечения лишних кусков: иначе их бы и срезало вместе с ними.
  const islets = plantIslets(land, rng, coastNoise, bay);

  // Поле расстояний растёт ОТ клеток заданного вида: чтобы узнать расстояние до воды,
  // отсчёт начинается от воды (land === 0), и наоборот.
  const distToWater = distanceField(land, 0);
  const distToLand = distanceField(land, 1);
  const openSea = markOpenSea(land);

  const { landHeight, waterDepth, landCells } = buildElevation(
    land,
    distToWater,
    distToLand,
    heightNoise,
    peak,
  );

  return {
    land,
    landHeight,
    waterDepth,
    distToWater,
    distToLand,
    openSea,
    bay,
    rockAngle,
    landCells,
    islets,
  };
}

/** Сколько островков бывает у острова. Больше — и главный перестаёт быть главным. */
const ISLET_COUNT = 2;

/** Разбег ширины островка в клетках. Меньше — не место, а камень; больше — второй остров. */
const ISLET_RADIUS = { min: 4, max: 7 };

/**
 * Насколько островок отстоит от берега. Не ближе — иначе он прирастёт к острову
 * и мост не понадобится; не дальше — иначе мостки выходят непомерно длинными.
 */
const ISLET_GAP = { min: 4, max: 11 };

/**
 * Сажает островки в открытом море вокруг главного острова.
 *
 * Место ищется перебором направлений от центра: идём по лучу, пока не кончится суша,
 * отступаем на зазор и проверяем, что вокруг действительно вода. Такой поиск не зависит
 * от формы берега — а она у каждого сида своя.
 */
function plantIslets(
  land: Uint8Array,
  rng: ReturnType<typeof createRng>,
  noise: ReturnType<typeof createNoise2D>,
  bay: Bay,
): Islet[] {
  const islets: Islet[] = [];

  for (let attempt = 0; attempt < 60 && islets.length < ISLET_COUNT; attempt += 1) {
    const angle = rng.range(0, Math.PI * 2);
    const radius = Math.round(rng.range(ISLET_RADIUS.min, ISLET_RADIUS.max));
    const gap = rng.range(ISLET_GAP.min, ISLET_GAP.max);

    const shore = shoreAlong(land, angle);
    if (shore === null) continue;

    const distance = shore + gap + radius;
    const x = Math.round(CENTER_X + Math.cos(angle) * distance);
    const z = Math.round(CENTER_Z + Math.sin(angle) * distance);

    // У края мира островку не место: там всегда должна оставаться вода.
    if (x - radius < 4 || z - radius < 4 || x + radius >= WORLD_X - 4 || z + radius >= WORLD_Z - 4) {
      continue;
    }

    // Бухта — дорога лодки. Загораживать её островком нельзя (§11 ТЗ, первая минута).
    if (Math.hypot(x - bay.x, z - bay.z) < bay.radius + radius + 6) continue;

    // Место должно быть чистой водой с запасом, иначе островок слипнется с берегом.
    if (!isOpenWater(land, x, z, radius + 3)) continue;
    if (islets.some((other) => Math.hypot(other.x - x, other.z - z) < other.radius + radius + 8)) {
      continue;
    }

    stampIslet(land, noise, { x, z, radius });
    islets.push({ x, z, radius });
  }

  return islets;
}

/** Как далеко от центра тянется суша в этом направлении. `null` — берега там нет. */
function shoreAlong(land: Uint8Array, angle: number): number | null {
  let last: number | null = null;

  for (let distance = 4; distance < ISLAND_RADIUS + 12; distance += 1) {
    const x = Math.round(CENTER_X + Math.cos(angle) * distance);
    const z = Math.round(CENTER_Z + Math.sin(angle) * distance);
    if (x < 0 || z < 0 || x >= WORLD_X || z >= WORLD_Z) break;
    if (land[columnIndex(x, z)] === 1) last = distance;
  }

  return last;
}

/** Чистая ли вода в круге заданного радиуса. */
function isOpenWater(land: Uint8Array, cx: number, cz: number, radius: number): boolean {
  for (let z = cz - radius; z <= cz + radius; z += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (x < 0 || z < 0 || x >= WORLD_X || z >= WORLD_Z) return false;
      if (Math.hypot(x - cx, z - cz) > radius) continue;
      if (land[columnIndex(x, z)] === 1) return false;
    }
  }
  return true;
}

/** Кладёт островок на карту суши. Форма неровная — по тому же шуму, что и берег. */
function stampIslet(land: Uint8Array, noise: ReturnType<typeof createNoise2D>, islet: Islet): void {
  for (let z = islet.z - islet.radius; z <= islet.z + islet.radius; z += 1) {
    for (let x = islet.x - islet.radius; x <= islet.x + islet.radius; x += 1) {
      if (x < 1 || z < 1 || x >= WORLD_X - 1 || z >= WORLD_Z - 1) continue;

      const distance = Math.hypot(x - islet.x, z - islet.z) / islet.radius;
      const edge = fbm2(noise, x * 0.09, z * 0.09, { octaves: 2 }) * 0.3;
      if (distance + edge > 0.95) continue;

      land[columnIndex(x, z)] = 1;
    }
  }
}

/** Радиальный спад плюс шум берега: чем дальше от центра, тем меньше шансов быть сушей. */
function buildLandValue(coastNoise: ReturnType<typeof createNoise2D>, bay: Bay): Float32Array {
  const values = new Float32Array(WORLD_COLUMN_COUNT);

  for (let z = 0; z < WORLD_Z; z += 1) {
    for (let x = 0; x < WORLD_X; x += 1) {
      const dx = x - CENTER_X;
      const dz = z - CENTER_Z;
      const normalized = Math.hypot(dx, dz) / ISLAND_RADIUS;

      const falloff = 1 - smoothstep(0.32, 1, normalized);
      const shore = fbm2(coastNoise, x * 0.018, z * 0.018, { octaves: 3 });

      // Вырезаем бухту: в её пятне суша становится маловероятной.
      const toBay = Math.hypot(x - bay.x, z - bay.z);
      const bayCut = 1 - smoothstep(0, bay.radius, toBay);

      values[columnIndex(x, z)] = falloff + shore * 0.36 - bayCut * 0.62;
    }
  }

  return values;
}

/**
 * Порог подбирается так, чтобы площадь суши всегда была одинаковой.
 *
 * Без этого один сид давал бы островок на четверть экрана, а другой — почти весь мир:
 * играть на них пришлось бы по-разному, а это не то разнообразие, которое нужно.
 */
function thresholdToTargetArea(values: Float32Array): Uint8Array {
  const target = Math.round(WORLD_COLUMN_COUNT * LAND_FRACTION);

  const countAbove = (threshold: number): number => {
    let count = 0;
    for (const value of values) if (value > threshold) count += 1;
    return count;
  };

  let low = -2;
  let high = 2;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;
    if (countAbove(middle) > target) low = middle;
    else high = middle;
  }

  const threshold = (low + high) / 2;
  const land = new Uint8Array(WORLD_COLUMN_COUNT);
  for (let i = 0; i < values.length; i += 1) land[i] = (values[i] ?? 0) > threshold ? 1 : 0;
  return land;
}

/**
 * Оставляет только самый большой кусок суши. Мелкие островки-спутники топим:
 * до них нельзя дойти пешком, а мосты открываются по главам и ставятся осознанно.
 */
function keepLargestLandmass(land: Uint8Array): void {
  const component = new Int32Array(WORLD_COLUMN_COUNT).fill(-1);
  const queue = new Int32Array(WORLD_COLUMN_COUNT);

  let bestComponent = -1;
  let bestSize = 0;
  let componentCount = 0;

  for (let start = 0; start < WORLD_COLUMN_COUNT; start += 1) {
    if (land[start] !== 1 || component[start] !== -1) continue;

    const id = componentCount;
    componentCount += 1;

    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    component[start] = id;
    let size = 0;

    while (head < tail) {
      const current = queue[head] ?? 0;
      head += 1;
      size += 1;

      // Соседи перебираются вручную по индексу: на 25 600 клеток и несколько обходов
      // выделение массива на каждую клетку было заметной частью времени генерации.
      const x = current % WORLD_X;
      const visit = (index: number): void => {
        if (land[index] === 1 && component[index] === -1) {
          component[index] = id;
          queue[tail] = index;
          tail += 1;
        }
      };

      if (x > 0) visit(current - 1);
      if (x < WORLD_X - 1) visit(current + 1);
      if (current >= WORLD_X) visit(current - WORLD_X);
      if (current + WORLD_X < WORLD_COLUMN_COUNT) visit(current + WORLD_X);
    }

    if (size > bestSize) {
      bestSize = size;
      bestComponent = id;
    }
  }

  for (let i = 0; i < WORLD_COLUMN_COUNT; i += 1) {
    if (land[i] === 1 && component[i] !== bestComponent) land[i] = 0;
  }
}

/** Вода, до которой можно доплыть от края мира. Всё остальное — внутренние пруды. */
function markOpenSea(land: Uint8Array): Uint8Array {
  const open = new Uint8Array(WORLD_COLUMN_COUNT);
  const queue = new Int32Array(WORLD_COLUMN_COUNT);
  let head = 0;
  let tail = 0;

  const push = (index: number): void => {
    if (land[index] === 1 || open[index] === 1) return;
    open[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < WORLD_X; x += 1) {
    push(columnIndex(x, 0));
    push(columnIndex(x, WORLD_Z - 1));
  }
  for (let z = 0; z < WORLD_Z; z += 1) {
    push(columnIndex(0, z));
    push(columnIndex(WORLD_X - 1, z));
  }

  while (head < tail) {
    const current = queue[head] ?? 0;
    head += 1;
    const x = current % WORLD_X;

    if (x > 0) push(current - 1);
    if (x < WORLD_X - 1) push(current + 1);
    if (current >= WORLD_X) push(current - WORLD_X);
    if (current + WORLD_X < WORLD_COLUMN_COUNT) push(current + WORLD_X);
  }

  return open;
}

/**
 * Расстояние в клетках ДО ближайшей клетки со значением `from` — обход в ширину от всех
 * таких клеток разом. Нужно и для формы берега, и для глубины воды, и для биомов.
 *
 * Направление легко перепутать: отсчёт идёт от клеток `from`, поэтому расстояние до воды
 * считается полем, засеянным по воде.
 */
function distanceField(land: Uint8Array, from: number): Int16Array {
  const distance = new Int16Array(WORLD_COLUMN_COUNT).fill(-1);
  const queue = new Int32Array(WORLD_COLUMN_COUNT);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < WORLD_COLUMN_COUNT; i += 1) {
    if (land[i] === from) {
      distance[i] = 0;
      queue[tail] = i;
      tail += 1;
    }
  }

  while (head < tail) {
    const current = queue[head] ?? 0;
    head += 1;
    const next = (distance[current] ?? 0) + 1;
    const x = current % WORLD_X;

    const visit = (index: number): void => {
      if (distance[index] === -1) {
        distance[index] = next;
        queue[tail] = index;
        tail += 1;
      }
    };

    if (x > 0) visit(current - 1);
    if (x < WORLD_X - 1) visit(current + 1);
    if (current >= WORLD_X) visit(current - WORLD_X);
    if (current + WORLD_X < WORLD_COLUMN_COUNT) visit(current + WORLD_X);
  }

  return distance;
}

function buildElevation(
  land: Uint8Array,
  distToWater: Int16Array,
  distToLand: Int16Array,
  heightNoise: ReturnType<typeof createNoise2D>,
  peak: { x: number; z: number; radius: number },
): { landHeight: Uint8Array; waterDepth: Uint8Array; landCells: number } {
  const landHeight = new Uint8Array(WORLD_COLUMN_COUNT);
  const waterDepth = new Uint8Array(WORLD_COLUMN_COUNT);
  let landCells = 0;

  for (let z = 0; z < WORLD_Z; z += 1) {
    for (let x = 0; x < WORLD_X; x += 1) {
      const index = columnIndex(x, z);
      const noise = (fbm2(heightNoise, x * 0.035, z * 0.035, { octaves: 4 }) + 1) * 0.5;

      if (land[index] === 1) {
        landCells += 1;

        // Чем дальше от воды, тем выше: у воды получается пляж, а не обрыв.
        const inland = smoothstep(0, 16, distToWater[index] ?? 0);

        // Луг остаётся пологим: по нему ходят, на нём строят, и рельеф не должен мешать.
        const meadow = inland * (2 + 5 * noise);

        // Скала растёт к одной вершине и круто обрывается — так она читается силуэтом.
        const toPeak = Math.hypot(x - peak.x, z - peak.z);
        const rise = 1 - smoothstep(0, peak.radius, toPeak);
        const rocks = rise * rise * inland * (5 + 13 * noise);

        landHeight[index] = clamp(Math.round(1 + meadow + rocks), 1, MAX_LAND_HEIGHT);
      } else {
        const offshore = smoothstep(0, 20, distToLand[index] ?? 0);
        waterDepth[index] = clamp(Math.round(1 + offshore * 9 + noise), 1, 12);
      }
    }
  }

  return { landHeight, waterDepth, landCells };
}
