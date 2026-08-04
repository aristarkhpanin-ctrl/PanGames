import { materialColor } from '../content/palette';
import {
  CHUNK_X,
  CHUNK_Y,
  CHUNK_Z,
  chunkOrigin,
  isOpaque,
  Material,
  voxelIndex,
  WORLD_X,
  WORLD_Y,
  WORLD_Z,
} from '../voxels';

/**
 * Greedy meshing чанка: соседние одинаковые грани объединяются в прямоугольники,
 * поэтому ровное поле превращается в несколько больших четырёхугольников, а не в тысячи мелких.
 *
 * Функция чистая — на вход массив вокселей, на выход буферы геометрии. Ни three.js, ни DOM
 * здесь нет, поэтому алгоритм тестируется в Node, а исполняется в воркере (§2.4, §12 ТЗ).
 *
 * Затенение (AO) запекается в цвет вершины прямо здесь. Текстур в проекте нет вообще,
 * и вместе с палитрой именно AO делает воксели объёмными.
 */

export interface ChunkMesh {
  /** Метры относительно начала чанка. */
  positions: Float32Array;
  normals: Float32Array;
  /** Цвет материала, уже умноженный на затенение. */
  colors: Float32Array;
  indices: Uint32Array;
  quadCount: number;
}

/**
 * Яркость по четырём уровням затенения. Нижняя граница не ноль: полностью чёрный угол
 * в этой палитре выглядит грязью, а не тенью.
 */
const AO_BRIGHTNESS = [0.55, 0.72, 0.86, 1] as const;

/**
 * Пометка «за пределами мира». Не материал: там не должно появляться граней вообще.
 *
 * Подставлять снаружи камень нельзя — тогда он сам начинает граничить с воздухом мира
 * и порождает стену граней по всему краю. Для затенения снаружи считается плотным,
 * чтобы у обрыва на краю карты не было светлой каймы.
 */
const OUTSIDE = 255;

/** Габариты копии чанка с полем в один воксель на каждую сторону. */
const PAD_X = CHUNK_X + 2;
const PAD_Y = WORLD_Y + 2;
const PAD_Z = CHUNK_Z + 2;

function padIndex(lx: number, ly: number, lz: number): number {
  return lx + 1 + PAD_X * (lz + 1 + PAD_Z * (ly + 1));
}

/**
 * Копия чанка с полями: материалы и признак непрозрачности.
 *
 * Все проверки границ делаются один раз здесь, а не миллионы раз во внутреннем цикле —
 * на полном острове это разница между 1,7 секунды и десятками миллисекунд.
 */
function copyWithPadding(
  voxels: Uint8Array,
  originX: number,
  originZ: number,
): { material: Uint8Array; opaque: Uint8Array; yLow: number; yHigh: number } {
  const material = new Uint8Array(PAD_X * PAD_Y * PAD_Z);
  const opaque = new Uint8Array(PAD_X * PAD_Y * PAD_Z);

  // Слой интересен, только если в нём есть и плотное, и пустое — иначе граням взяться неоткуда.
  const hasOpaque = new Uint8Array(PAD_Y);
  const hasClear = new Uint8Array(PAD_Y);

  for (let ly = -1; ly <= WORLD_Y; ly += 1) {
    for (let lz = -1; lz <= CHUNK_Z; lz += 1) {
      for (let lx = -1; lx <= CHUNK_X; lx += 1) {
        const wx = originX + lx;
        const wz = originZ + lz;

        let value: number;
        if (ly >= WORLD_Y) value = Material.AIR;
        else if (ly < 0 || wx < 0 || wx >= WORLD_X || wz < 0 || wz >= WORLD_Z) value = OUTSIDE;
        else value = voxels[voxelIndex(wx, ly, wz)] ?? Material.AIR;

        const index = padIndex(lx, ly, lz);
        material[index] = value;

        if (value === OUTSIDE) {
          opaque[index] = 1;
        } else if (isOpaque(value)) {
          opaque[index] = 1;
          hasOpaque[ly + 1] = 1;
        } else {
          opaque[index] = 0;
          hasClear[ly + 1] = 1;
        }
      }
    }
  }

  // Мир высотой 96 вокселей, а рельеф занимает узкую полосу: остальное — сплошной камень
  // снизу и сплошной воздух сверху, и ни то ни другое граней не даёт.
  let yLow = WORLD_Y;
  let yHigh = -1;
  for (let y = 0; y < WORLD_Y; y += 1) {
    const near = (flags: Uint8Array): boolean =>
      flags[y] === 1 || flags[y + 1] === 1 || flags[y + 2] === 1;
    if (near(hasOpaque) && near(hasClear)) {
      if (y < yLow) yLow = y;
      if (y > yHigh) yHigh = y;
    }
  }

  return { material, opaque, yLow, yHigh };
}

export function meshChunk(voxels: Uint8Array, chunk: number): ChunkMesh {
  const origin = chunkOrigin(chunk);
  const pad = copyWithPadding(voxels, origin.x, origin.z);

  const voxelAt = (lx: number, ly: number, lz: number): number =>
    pad.material[padIndex(lx, ly, lz)] ?? OUTSIDE;

  const opaqueAt = (lx: number, ly: number, lz: number): number =>
    pad.opaque[padIndex(lx, ly, lz)] ?? 1;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let quadCount = 0;

  for (let d = 0; d < 3; d += 1) {
    // Оси: a — вдоль нормали, b и c — в плоскости грани. Базисы циклически сдвинуты,
    // поэтому локальная позиция считается арифметикой, без ветвлений в горячем цикле.
    const dimA = d === 0 ? CHUNK_X : d === 1 ? CHUNK_Y : CHUNK_Z;
    const dimB = d === 0 ? CHUNK_Y : d === 1 ? CHUNK_Z : CHUNK_X;
    const dimC = d === 0 ? CHUNK_Z : d === 1 ? CHUNK_X : CHUNK_Y;

    const nx = d === 0 ? 1 : 0;
    const ny = d === 1 ? 1 : 0;
    const nz = d === 2 ? 1 : 0;
    const bx = d === 1 ? 0 : d === 2 ? 1 : 0;
    const by = d === 0 ? 1 : 0;
    const bz = d === 1 ? 1 : 0;
    const cx = d === 1 ? 1 : 0;
    const cy = d === 2 ? 1 : 0;
    const cz = d === 0 ? 1 : 0;

    const maskMaterial = new Int32Array(dimB * dimC);
    const maskShade = new Int32Array(dimB * dimC);

    // Ограничиваем обход полосой рельефа по той оси, которая совпадает с вертикалью.
    const aFrom = d === 1 ? Math.max(-1, pad.yLow - 1) : -1;
    const aTo = d === 1 ? Math.min(dimA - 1, pad.yHigh) : dimA - 1;
    const bFrom = d === 0 ? Math.max(0, pad.yLow) : 0;
    const bTo = d === 0 ? Math.min(dimB - 1, pad.yHigh) : dimB - 1;
    const cFrom = d === 2 ? Math.max(0, pad.yLow) : 0;
    const cTo = d === 2 ? Math.min(dimC - 1, pad.yHigh) : dimC - 1;

    for (let a = aFrom; a <= aTo; a += 1) {
      // Маска чистится целиком: заполняем мы только полосу, а склейка идёт по всей площади.
      maskMaterial.fill(0);

      for (let c = cFrom; c <= cTo; c += 1) {
        for (let b = bFrom; b <= bTo; b += 1) {
          const n = b + c * dimB;
          const lx = a * nx + b * bx + c * cx;
          const ly = a * ny + b * by + c * cy;
          const lz = a * nz + b * bz + c * cz;

          const here = voxelAt(lx, ly, lz);
          const ahead = voxelAt(lx + nx, ly + ny, lz + nz);

          // За краем мира граней не бывает ни с какой стороны.
          if (here === OUTSIDE || ahead === OUTSIDE) {
            maskMaterial[n] = 0;
            continue;
          }

          const hereOpaque = isOpaque(here);
          const aheadOpaque = isOpaque(ahead);

          if (hereOpaque === aheadOpaque) {
            maskMaterial[n] = 0;
            continue;
          }

          // Грань принадлежит непрозрачному вокселю и смотрит в сторону пустого.
          // Знак хранит направление нормали, модуль — материал.
          const facingForward = hereOpaque;
          const material = facingForward ? here : ahead;
          maskMaterial[n] = facingForward ? material : -material;

          // Затенение считается вокруг пустого соседа: именно он открыт свету.
          const ox = facingForward ? lx + nx : lx;
          const oy = facingForward ? ly + ny : ly;
          const oz = facingForward ? lz + nz : lz;

          const corner = (db: number, dc: number): number => {
            const side1 = opaqueAt(ox + db * bx, oy + db * by, oz + db * bz);
            const side2 = opaqueAt(ox + dc * cx, oy + dc * cy, oz + dc * cz);
            // Два перекрытых бока полностью закрывают угол — диагональ можно не смотреть.
            if (side1 === 1 && side2 === 1) return 0;
            const diagonal = opaqueAt(
              ox + db * bx + dc * cx,
              oy + db * by + dc * cy,
              oz + db * bz + dc * cz,
            );
            return 3 - (side1 + side2 + diagonal);
          };

          maskShade[n] =
            corner(-1, -1) | (corner(1, -1) << 2) | (corner(1, 1) << 4) | (corner(-1, 1) << 6);
        }
      }

      const slab = a + 1;

      for (let c = 0; c < dimC; c += 1) {
        for (let b = 0; b < dimB;) {
          const n = b + c * dimB;
          const material = maskMaterial[n] ?? 0;
          if (material === 0) {
            b += 1;
            continue;
          }
          const shade = maskShade[n] ?? 0;

          // Растягиваем прямоугольник сначала вширь, потом ввысь. Объединяются только
          // клетки с одинаковым материалом И одинаковым затенением, иначе тень «поедет».
          let width = 1;
          while (
            b + width < dimB &&
            maskMaterial[n + width] === material &&
            maskShade[n + width] === shade
          ) {
            width += 1;
          }

          let height = 1;
          grow: while (c + height < dimC) {
            for (let k = 0; k < width; k += 1) {
              const probe = n + k + height * dimB;
              if (maskMaterial[probe] !== material || maskShade[probe] !== shade) break grow;
            }
            height += 1;
          }

          emitQuad(
            positions,
            normals,
            colors,
            indices,
            { slab, b, c, width, height, material, shade },
            { nx, ny, nz, bx, by, bz, cx, cy, cz },
          );
          quadCount += 1;

          for (let dc = 0; dc < height; dc += 1) {
            for (let db = 0; db < width; db += 1) {
              maskMaterial[n + db + dc * dimB] = 0;
            }
          }

          b += width;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    quadCount,
  };
}

interface QuadSpec {
  slab: number;
  b: number;
  c: number;
  width: number;
  height: number;
  /** Со знаком: минус — нормаль против оси. */
  material: number;
  shade: number;
}

interface AxisBasis {
  nx: number;
  ny: number;
  nz: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
}

/** Размер вокселя в метрах — геометрия сразу выдаётся в мировом масштабе. */
const SCALE = 0.5;

function emitQuad(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  quad: QuadSpec,
  axis: AxisBasis,
): void {
  const forward = quad.material > 0;
  const material = Math.abs(quad.material);
  const { nx, ny, nz, bx, by, bz, cx, cy, cz } = axis;

  const baseX = quad.slab * nx + quad.b * bx + quad.c * cx;
  const baseY = quad.slab * ny + quad.b * by + quad.c * cy;
  const baseZ = quad.slab * nz + quad.b * bz + quad.c * cz;

  const wx = quad.width * bx;
  const wy = quad.width * by;
  const wz = quad.width * bz;
  const hx = quad.height * cx;
  const hy = quad.height * cy;
  const hz = quad.height * cz;

  const cornerX = [baseX, baseX + wx, baseX + wx + hx, baseX + hx];
  const cornerY = [baseY, baseY + wy, baseY + wy + hy, baseY + hy];
  const cornerZ = [baseZ, baseZ + wz, baseZ + wz + hz, baseZ + hz];

  const color = materialColor(material);
  const red = ((color >> 16) & 0xff) / 255;
  const green = ((color >> 8) & 0xff) / 255;
  const blue = (color & 0xff) / 255;

  const shades = [
    (quad.shade >> 0) & 3,
    (quad.shade >> 2) & 3,
    (quad.shade >> 4) & 3,
    (quad.shade >> 6) & 3,
  ];

  const first = positions.length / 3;

  for (let corner = 0; corner < 4; corner += 1) {
    positions.push(
      (cornerX[corner] ?? 0) * SCALE,
      (cornerY[corner] ?? 0) * SCALE,
      (cornerZ[corner] ?? 0) * SCALE,
    );

    const sign = forward ? 1 : -1;
    normals.push(nx * sign, ny * sign, nz * sign);

    const brightness = AO_BRIGHTNESS[shades[corner] ?? 3] ?? 1;
    colors.push(red * brightness, green * brightness, blue * brightness);
  }

  /**
   * Разрез четырёхугольника ведётся по более тёмной диагонали. Иначе на углах с разным
   * затенением видно ступеньку — классический артефакт воксельного AO.
   */
  const flip = (shades[0] ?? 3) + (shades[2] ?? 3) > (shades[1] ?? 3) + (shades[3] ?? 3);

  if (forward) {
    if (flip) indices.push(first + 1, first + 2, first + 3, first + 1, first + 3, first);
    else indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  } else {
    if (flip) indices.push(first + 3, first + 2, first + 1, first, first + 3, first + 1);
    else indices.push(first + 3, first + 2, first, first + 2, first + 1, first);
  }
}
