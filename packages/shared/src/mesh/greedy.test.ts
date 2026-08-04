import { describe, expect, it } from 'vitest';

import { CHUNK_X, Material, SEA_LEVEL, voxelIndex, WORLD_VOXEL_COUNT, WORLD_Y } from '../voxels';
import { generateIsland } from '../worldgen/island';
import { meshChunk } from './greedy';

function emptyWorld(): Uint8Array {
  return new Uint8Array(WORLD_VOXEL_COUNT);
}

function put(voxels: Uint8Array, x: number, y: number, z: number, material: number): void {
  voxels[voxelIndex(x, y, z)] = material;
}

/** Геометрическая нормаль треугольника — та ли сторона наружу. */
function triangleNormal(
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
): [number, number, number] {
  const ax = positions[a * 3] ?? 0;
  const ay = positions[a * 3 + 1] ?? 0;
  const az = positions[a * 3 + 2] ?? 0;
  const e1x = (positions[b * 3] ?? 0) - ax;
  const e1y = (positions[b * 3 + 1] ?? 0) - ay;
  const e1z = (positions[b * 3 + 2] ?? 0) - az;
  const e2x = (positions[c * 3] ?? 0) - ax;
  const e2y = (positions[c * 3 + 1] ?? 0) - ay;
  const e2z = (positions[c * 3 + 2] ?? 0) - az;
  return [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
}

describe('meshChunk — основы', () => {
  it('пустой чанк не даёт геометрии', () => {
    const mesh = meshChunk(emptyWorld(), 0);
    expect(mesh.quadCount).toBe(0);
    expect(mesh.positions).toHaveLength(0);
    expect(mesh.indices).toHaveLength(0);
  });

  it('одинокий воксель даёт ровно шесть граней', () => {
    const voxels = emptyWorld();
    put(voxels, 5, 40, 5, Material.STONE);

    const mesh = meshChunk(voxels, 0);
    expect(mesh.quadCount).toBe(6);
    expect(mesh.positions).toHaveLength(6 * 4 * 3);
    expect(mesh.indices).toHaveLength(6 * 6);
  });

  it('все грани смотрят наружу', () => {
    // Вывернутые грани не видно на плоском рельефе, но на любом обрыве это дыра в мире.
    const voxels = emptyWorld();
    put(voxels, 5, 40, 5, Material.STONE);
    const mesh = meshChunk(voxels, 0);

    let wrong = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i] ?? 0;
      const b = mesh.indices[i + 1] ?? 0;
      const c = mesh.indices[i + 2] ?? 0;
      const [gx, gy, gz] = triangleNormal(mesh.positions, a, b, c);
      const nx = mesh.normals[a * 3] ?? 0;
      const ny = mesh.normals[a * 3 + 1] ?? 0;
      const nz = mesh.normals[a * 3 + 2] ?? 0;
      if (gx * nx + gy * ny + gz * nz <= 0) wrong += 1;
    }
    expect(wrong).toBe(0);
  });

  it('соседние воксели не рисуют грань между собой и сливаются', () => {
    const voxels = emptyWorld();
    put(voxels, 5, 40, 5, Material.STONE);
    put(voxels, 6, 40, 5, Material.STONE);

    // Два куба по отдельности дали бы 12 граней. Внутренние две не нужны, а из оставшихся
    // десяти совпадающие попарно сливаются — ровно ради этого greedy meshing и существует.
    expect(meshChunk(voxels, 0).quadCount).toBe(6);
  });

  it('плоская плита объединяется в шесть прямоугольников', () => {
    const voxels = emptyWorld();
    for (let z = 4; z < 8; z += 1) {
      for (let x = 4; x < 8; x += 1) put(voxels, x, 40, z, Material.GRASS);
    }

    // Ради этого greedy meshing и нужен: 16 кубов дали бы 40 граней, а нужно 6.
    expect(meshChunk(voxels, 0).quadCount).toBe(6);
  });

  it('индексы ссылаются на существующие вершины', () => {
    const voxels = emptyWorld();
    for (let z = 4; z < 9; z += 1) {
      for (let x = 4; x < 9; x += 1) put(voxels, x, 40, z, Material.GRASS);
    }
    const mesh = meshChunk(voxels, 0);
    const vertices = mesh.positions.length / 3;

    let broken = 0;
    for (const index of mesh.indices) if (index >= vertices) broken += 1;
    expect(broken).toBe(0);
  });

  it('нормали единичные и вдоль осей', () => {
    const voxels = emptyWorld();
    put(voxels, 5, 40, 5, Material.STONE);
    const mesh = meshChunk(voxels, 0);

    let wrong = 0;
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const x = mesh.normals[i] ?? 0;
      const y = mesh.normals[i + 1] ?? 0;
      const z = mesh.normals[i + 2] ?? 0;
      if (Math.abs(Math.abs(x) + Math.abs(y) + Math.abs(z) - 1) > 1e-6) wrong += 1;
    }
    expect(wrong).toBe(0);
  });
});

describe('meshChunk — границы мира и чанков', () => {
  it('на стыке чанков грань не появляется', () => {
    const voxels = emptyWorld();
    // Последний столбец нулевого чанка и первый столбец соседнего.
    put(voxels, CHUNK_X - 1, 40, 5, Material.STONE);
    put(voxels, CHUNK_X, 40, 5, Material.STONE);

    const mesh = meshChunk(voxels, 0);
    // Пять граней: шестая упирается в соседний чанк, там уже камень.
    expect(mesh.quadCount).toBe(5);
  });

  it('дно мира не мешится', () => {
    // Иначе под островом висел бы сплошной прямоугольник, который никто никогда не увидит.
    const voxels = emptyWorld();
    put(voxels, 5, 0, 5, Material.STONE);
    expect(meshChunk(voxels, 0).quadCount).toBe(5);
  });

  it('край мира по горизонтали не мешится', () => {
    const voxels = emptyWorld();
    put(voxels, 0, 40, 5, Material.STONE);
    expect(meshChunk(voxels, 0).quadCount).toBe(5);
  });

  it('потолок мира остаётся открытым', () => {
    const voxels = emptyWorld();
    put(voxels, 5, WORLD_Y - 1, 5, Material.STONE);
    expect(meshChunk(voxels, 0).quadCount).toBe(6);
  });
});

describe('meshChunk — вода и прозрачное', () => {
  it('вода не даёт граней, но дно под ней видно', () => {
    const voxels = emptyWorld();
    put(voxels, 5, SEA_LEVEL - 1, 5, Material.SAND);
    for (let y = SEA_LEVEL; y <= SEA_LEVEL; y += 1) put(voxels, 5, y, 5, Material.WATER);

    const mesh = meshChunk(voxels, 0);
    // Ровно куб песка: вода прозрачна, её грани рисует отдельный слой (§2.5 ТЗ).
    expect(mesh.quadCount).toBe(6);
  });

  it('стекло не перекрывает соседей', () => {
    const voxels = emptyWorld();
    put(voxels, 5, 40, 5, Material.STONE);
    put(voxels, 6, 40, 5, Material.GLASS);

    // Камень сохраняет все шесть граней: сквозь стекло его видно.
    const mesh = meshChunk(voxels, 0);
    expect(mesh.quadCount).toBe(6);
  });
});

describe('meshChunk — затенение', () => {
  it('открытый угол светлее закрытого', () => {
    const voxels = emptyWorld();
    // Плита с одной стенкой: у стенки верхняя грань должна потемнеть.
    for (let z = 3; z < 10; z += 1) {
      for (let x = 3; x < 10; x += 1) put(voxels, x, 40, z, Material.GRASS);
    }
    for (let z = 3; z < 10; z += 1) put(voxels, 3, 41, z, Material.STONE);

    const mesh = meshChunk(voxels, 0);
    let brightest = 0;
    let darkest = 1;
    for (let i = 0; i < mesh.colors.length; i += 3) {
      const value = mesh.colors[i] ?? 0;
      brightest = Math.max(brightest, value);
      darkest = Math.min(darkest, value);
    }

    expect(darkest).toBeLessThan(brightest);
  });

  it('одинокая плита затенена ровно', () => {
    const voxels = emptyWorld();
    for (let z = 4; z < 8; z += 1) {
      for (let x = 4; x < 8; x += 1) put(voxels, x, 40, z, Material.GRASS);
    }
    const mesh = meshChunk(voxels, 0);

    // Верхняя грань ничем не перекрыта, значит объединилась в один прямоугольник —
    // а это возможно только при одинаковом затенении во всех её углах.
    expect(mesh.quadCount).toBe(6);
  });
});

describe('meshChunk — настоящий остров', () => {
  const island = generateIsland(42);

  it('укладывается в бюджет треугольников', () => {
    let triangles = 0;
    let quads = 0;
    for (let chunk = 0; chunk < 25; chunk += 1) {
      const mesh = meshChunk(island.voxels, chunk);
      triangles += mesh.indices.length / 3;
      quads += mesh.quadCount;
    }

    // Бюджет §2 ТЗ — меньше 250 000 треугольников на всю сцену.
    expect(triangles).toBeLessThan(250_000);
    expect(quads).toBeGreaterThan(1000);
  });

  it('весь остров мешится быстрее секунды', () => {
    const started = Date.now();
    for (let chunk = 0; chunk < 25; chunk += 1) meshChunk(island.voxels, chunk);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('вся геометрия остаётся в пределах чанка', () => {
    const mesh = meshChunk(island.voxels, 12);
    let outside = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i] ?? 0;
      const y = mesh.positions[i + 1] ?? 0;
      const z = mesh.positions[i + 2] ?? 0;
      if (x < 0 || x > 16 || y < 0 || y > 48 || z < 0 || z > 16) outside += 1;
    }
    expect(outside).toBe(0);
  });
});
