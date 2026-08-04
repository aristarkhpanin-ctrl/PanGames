import { type Rng } from './rng';

/**
 * Шум Перлина, 2D и 3D, с таблицей перестановок из сида.
 *
 * Написан внутри пакета намеренно: у `packages/shared` нет рантайм-зависимостей, а библиотеки
 * шума обычно тянут за собой либо сборку, либо недетерминированную инициализацию.
 *
 * Значение всегда лежит в [-1, 1] — это проверяется тестом на большой выборке.
 */

export type Noise2D = (x: number, y: number) => number;
export type Noise3D = (x: number, y: number, z: number) => number;

/**
 * Нормировочные множители: «сырой» Перлин не дотягивает до единицы по модулю.
 * Значения подобраны по замеру максимума на выборке и проверяются тестом —
 * если поменяется таблица градиентов, тест это поймает.
 */
const NORMALIZE_2D = 1.4142135623730951; // √2
const NORMALIZE_3D = 1.1547005383792515; // 2/√3

/**
 * Таблицы градиентов лежат плоскими массивами чисел, а не массивами пар.
 * Генератор острова делает около 180 000 обращений к шуму, и на массиве массивов
 * это превращалось в столько же переходов по указателям — самая дорогая часть генерации.
 */

/** Восемь единичных градиентов, равномерно по кругу: пары (x, y) подряд. */
const GRAD_2D = new Float64Array(16);
for (let i = 0; i < 8; i += 1) {
  const angle = (i * Math.PI) / 4;
  GRAD_2D[i * 2] = Math.cos(angle);
  GRAD_2D[i * 2 + 1] = Math.sin(angle);
}

/** Двенадцать классических градиентов Перлина — середины рёбер куба, тройками подряд. */
const GRAD_3D = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1,
  0, 1, -1, 0, -1, -1,
]);

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function buildPermutation(rng: Rng): Uint8Array {
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) source[i] = i;

  // Тасование Фишера — Йетса на seeded PRNG: перестановка воспроизводима по сиду.
  for (let i = 255; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const tmp = source[i] ?? 0;
    source[i] = source[j] ?? 0;
    source[j] = tmp;
  }

  const permutation = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) permutation[i] = source[i & 255] ?? 0;
  return permutation;
}

export function createNoise2D(rng: Rng): Noise2D {
  const p = buildPermutation(rng);

  return (x, y) => {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const xi = floorX & 255;
    const yi = floorY & 255;
    const xf = x - floorX;
    const yf = y - floorY;
    const u = fade(xf);
    const v = fade(yf);

    const a = (p[xi] ?? 0) + yi;
    const b = (p[xi + 1] ?? 0) + yi;

    const g00 = ((p[a] ?? 0) & 7) * 2;
    const g10 = ((p[b] ?? 0) & 7) * 2;
    const g01 = ((p[a + 1] ?? 0) & 7) * 2;
    const g11 = ((p[b + 1] ?? 0) & 7) * 2;

    const value = lerp(
      lerp(
        (GRAD_2D[g00] ?? 0) * xf + (GRAD_2D[g00 + 1] ?? 0) * yf,
        (GRAD_2D[g10] ?? 0) * (xf - 1) + (GRAD_2D[g10 + 1] ?? 0) * yf,
        u,
      ),
      lerp(
        (GRAD_2D[g01] ?? 0) * xf + (GRAD_2D[g01 + 1] ?? 0) * (yf - 1),
        (GRAD_2D[g11] ?? 0) * (xf - 1) + (GRAD_2D[g11 + 1] ?? 0) * (yf - 1),
        u,
      ),
      v,
    );

    return Math.max(-1, Math.min(1, value * NORMALIZE_2D));
  };
}

export function createNoise3D(rng: Rng): Noise3D {
  const p = buildPermutation(rng);

  return (x, y, z) => {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const floorZ = Math.floor(z);
    const xi = floorX & 255;
    const yi = floorY & 255;
    const zi = floorZ & 255;
    const xf = x - floorX;
    const yf = y - floorY;
    const zf = z - floorZ;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const dot = (hash: number, dx: number, dy: number, dz: number): number => {
      const g = (hash % 12) * 3;
      return (GRAD_3D[g] ?? 0) * dx + (GRAD_3D[g + 1] ?? 0) * dy + (GRAD_3D[g + 2] ?? 0) * dz;
    };

    const a = (p[xi] ?? 0) + yi;
    const aa = (p[a] ?? 0) + zi;
    const ab = (p[a + 1] ?? 0) + zi;
    const b = (p[xi + 1] ?? 0) + yi;
    const ba = (p[b] ?? 0) + zi;
    const bb = (p[b + 1] ?? 0) + zi;

    const value = lerp(
      lerp(
        lerp(dot(p[aa] ?? 0, xf, yf, zf), dot(p[ba] ?? 0, xf - 1, yf, zf), u),
        lerp(dot(p[ab] ?? 0, xf, yf - 1, zf), dot(p[bb] ?? 0, xf - 1, yf - 1, zf), u),
        v,
      ),
      lerp(
        lerp(dot(p[aa + 1] ?? 0, xf, yf, zf - 1), dot(p[ba + 1] ?? 0, xf - 1, yf, zf - 1), u),
        lerp(
          dot(p[ab + 1] ?? 0, xf, yf - 1, zf - 1),
          dot(p[bb + 1] ?? 0, xf - 1, yf - 1, zf - 1),
          u,
        ),
        v,
      ),
      w,
    );

    return Math.max(-1, Math.min(1, value * NORMALIZE_3D));
  };
}

export interface FbmOptions {
  octaves: number;
  /** Во сколько раз растёт частота на каждой октаве. */
  lacunarity?: number;
  /** Во сколько раз падает вклад каждой следующей октавы. */
  gain?: number;
}

/**
 * Фрактальный шум: сумма октав с растущей частотой и падающей амплитудой.
 * Результат нормирован, поэтому тоже лежит в [-1, 1].
 */
export function fbm2(noise: Noise2D, x: number, y: number, options: FbmOptions): number {
  const { octaves, lacunarity = 2, gain = 0.5 } = options;

  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let totalAmplitude = 0;

  for (let i = 0; i < octaves; i += 1) {
    // Сдвиг на каждой октаве разводит их решётки: без него октавы «слипаются» в узлах.
    sum += noise(x * frequency + i * 17.3, y * frequency + i * 31.7) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return totalAmplitude === 0 ? 0 : sum / totalAmplitude;
}
