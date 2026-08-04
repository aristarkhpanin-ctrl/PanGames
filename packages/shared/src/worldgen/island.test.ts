import { describe, expect, it } from 'vitest';

import {
  columnIndex,
  MAX_LAND_HEIGHT,
  Material,
  SEA_LEVEL,
  voxelIndex,
  WORLD_COLUMN_COUNT,
  WORLD_X,
  WORLD_Y,
  WORLD_Z,
} from '../voxels';
import { Biome, type BiomeId, countBiomes, LAND_BIOMES, slopeAt } from './biomes';
import { generateIsland, type GeneratedIsland } from './island';
import { type ResourceNodeKind } from './scatter';

/** Сколько сидов прогоняем через все инварианты. */
const SEEDS = 100;

/**
 * Насколько бухта должна быть закрыта сушей: доля направлений из её центра,
 * упирающихся в берег. Ниже 0.5 это уже не залив, а просто открытая вода.
 */
const MIN_BAY_ENCLOSURE = 0.5;

/**
 * Индекс первого различия или -1, если массивы совпадают.
 *
 * Глубокое сравнение из тестового движка на массиве в 2,4 миллиона элементов работает
 * десятки секунд — на таких объёмах сравниваем побайтово сами.
 */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

describe('generateIsland — детерминизм', () => {
  it('из одного сида даёт побитово одинаковый остров', () => {
    // Клиент и сервер восстанавливают мир из сида независимо друг от друга.
    // Любое расхождение здесь всплывёт уже на живом сервере, у игроков.
    for (const seed of [1, 4242, 999_999]) {
      const first = generateIsland(seed);
      const second = generateIsland(seed);

      expect(firstDifference(first.voxels, second.voxels)).toBe(-1);
      expect(firstDifference(first.surfaceY, second.surfaceY)).toBe(-1);
      expect(firstDifference(first.biomes, second.biomes)).toBe(-1);
      expect(second.trees).toEqual(first.trees);
      expect(second.resourceNodes).toEqual(first.resourceNodes);
      expect(second.curiosity).toEqual(first.curiosity);
    }
  });

  it('разные сиды дают разные острова', () => {
    expect(firstDifference(generateIsland(1).voxels, generateIsland(2).voxels)).not.toBe(-1);
  });
});

describe('generateIsland — инварианты на 100 сидах', () => {
  it('остров всегда пригоден для жизни', { timeout: 120_000 }, () => {
    const problems: string[] = [];

    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const island = generateIsland(seed);
      const report = (message: string): void => {
        problems.push(`сид ${String(seed)}: ${message}`);
      };

      checkLandmass(island, report);
      checkBiomes(island, report);
      checkBay(island, report);
      checkElevation(island, report);
      checkResources(island, report);
      checkCuriosity(island, report);
      checkTrees(island, report);

      // Полный обход вокселей дорогой, поэтому раз в десять сидов — но обход честный.
      if (seed % 10 === 0) checkColumnsSolid(island, report);
    }

    expect(problems).toEqual([]);
  });
});

/** Суша — один кусок: до любого места можно дойти пешком, без мостов и лодок. */
function checkLandmass(island: GeneratedIsland, report: (message: string) => void): void {
  const { land } = island.shape;

  let start = -1;
  let total = 0;
  for (let i = 0; i < WORLD_COLUMN_COUNT; i += 1) {
    if (land[i] === 1) {
      total += 1;
      if (start === -1) start = i;
    }
  }

  if (total < 7000 || total > 10_000) {
    report(`площадь суши ${String(total)} клеток вне разумных пределов`);
    return;
  }

  const visited = new Uint8Array(WORLD_COLUMN_COUNT);
  const queue = new Int32Array(WORLD_COLUMN_COUNT);
  let head = 0;
  let tail = 0;
  queue[tail] = start;
  tail += 1;
  visited[start] = 1;
  let reached = 0;

  while (head < tail) {
    const current = queue[head] ?? 0;
    head += 1;
    reached += 1;
    const x = current % WORLD_X;

    const visit = (index: number): void => {
      if (land[index] === 1 && visited[index] === 0) {
        visited[index] = 1;
        queue[tail] = index;
        tail += 1;
      }
    };

    if (x > 0) visit(current - 1);
    if (x < WORLD_X - 1) visit(current + 1);
    if (current >= WORLD_X) visit(current - WORLD_X);
    if (current + WORLD_X < WORLD_COLUMN_COUNT) visit(current + WORLD_X);
  }

  if (reached !== total) {
    report(`суша распалась на куски: достижимо ${String(reached)} из ${String(total)}`);
  }
}

/** Все биомы на месте, и ни один не подмял остальные. */
function checkBiomes(island: GeneratedIsland, report: (message: string) => void): void {
  const counts = countBiomes(island.biomes);
  const landTotal = LAND_BIOMES.reduce<number>((sum, biome) => sum + counts[biome], 0);

  for (const biome of [...LAND_BIOMES, Biome.SHALLOWS]) {
    if (counts[biome] === 0) report(`биом ${String(biome)} отсутствует`);
  }

  for (const biome of LAND_BIOMES) {
    if (counts[biome] > landTotal / 2) {
      report(`биом ${String(biome)} занял больше половины суши`);
    }
  }
}

/** Бухта — вода, соединённая с морем и закрытая берегом с большинства сторон. */
function checkBay(island: GeneratedIsland, report: (message: string) => void): void {
  const { bay, land, openSea } = island.shape;
  const bx = Math.round(bay.x);
  const bz = Math.round(bay.z);
  const center = columnIndex(bx, bz);

  if (land[center] === 1) {
    report('центр бухты оказался сушей');
    return;
  }
  if (openSea[center] !== 1) {
    report('бухта не соединена с открытым морем — в неё не войти лодке');
    return;
  }

  const rays = 16;
  const reach = 24;
  let hits = 0;

  for (let ray = 0; ray < rays; ray += 1) {
    const angle = (ray / rays) * Math.PI * 2;
    for (let step = 1; step <= reach; step += 1) {
      const x = Math.round(bx + Math.cos(angle) * step);
      const z = Math.round(bz + Math.sin(angle) * step);
      if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) break;
      if (land[columnIndex(x, z)] === 1) {
        hits += 1;
        break;
      }
    }
  }

  if (hits / rays < MIN_BAY_ENCLOSURE) {
    report(`бухта открыта со всех сторон — это не залив (${String(hits)} из ${String(rays)})`);
  }
}

function checkElevation(island: GeneratedIsland, report: (message: string) => void): void {
  const { land, landHeight, waterDepth } = island.shape;

  for (let i = 0; i < WORLD_COLUMN_COUNT; i += 1) {
    if (land[i] === 1) {
      const height = landHeight[i] ?? 0;
      if (height < 1 || height > MAX_LAND_HEIGHT) {
        report(`высота суши ${String(height)} вне 1..${String(MAX_LAND_HEIGHT)}`);
        return;
      }
    } else {
      const depth = waterDepth[i] ?? 0;
      if (depth < 1 || SEA_LEVEL - depth < 0) {
        report(`глубина воды ${String(depth)} невозможна`);
        return;
      }
    }
  }
}

/** Без любого из ресурсов остров упирается в тупик, а тупик запрещён уставом. */
function checkResources(island: GeneratedIsland, report: (message: string) => void): void {
  const kinds: ResourceNodeKind[] = ['stone', 'clay', 'sand', 'berry', 'fish'];

  for (const kind of kinds) {
    const nodes = island.resourceNodes.filter((node) => node.kind === kind);
    if (nodes.length === 0) {
      report(`нет ни одной залежи «${kind}»`);
      continue;
    }

    for (const node of nodes) {
      const column = columnIndex(node.x, node.z);
      const onLand = island.shape.land[column] === 1;
      if (kind === 'fish' ? onLand : !onLand) {
        report(`залежь «${kind}» стоит не на своём месте`);
        break;
      }
      if (node.amount <= 0 || node.amount > node.capacity) {
        report(`у залежи «${kind}» испорчен запас`);
        break;
      }
    }
  }

  const stone = island.resourceNodes
    .filter((node) => node.kind === 'stone')
    .reduce((sum, node) => sum + node.capacity, 0);
  if (stone < 4000) report(`камня всего ${String(stone)} — на полную застройку не хватит`);
}

function checkCuriosity(island: GeneratedIsland, report: (message: string) => void): void {
  const { curiosity } = island;
  if (curiosity === null) {
    report('на острове нет диковинки');
    return;
  }

  const column = columnIndex(curiosity.x, curiosity.z);
  const onLand = island.shape.land[column] === 1;
  const inShallows = island.biomes[column] === Biome.SHALLOWS;

  if (!onLand && !inShallows) report('диковинка оказалась в открытом море');
}

function checkTrees(island: GeneratedIsland, report: (message: string) => void): void {
  if (island.trees.length < 200) {
    report(`деревьев всего ${String(island.trees.length)} — остров выглядит лысым`);
  }

  const occupied = new Set<number>();
  for (const tree of island.trees) {
    const column = columnIndex(tree.x, tree.z);

    if (island.shape.land[column] !== 1) {
      report('дерево растёт в воде');
      return;
    }
    if (tree.y !== SEA_LEVEL + (island.shape.landHeight[column] ?? 0)) {
      report('дерево висит над землёй или утоплено в неё');
      return;
    }
    if (slopeAt(island.shape, tree.x, tree.z) >= 2) {
      report('дерево приклеено к обрыву');
      return;
    }
    if (occupied.has(column)) {
      report('два дерева в одной клетке');
      return;
    }
    occupied.add(column);
  }
}

/**
 * Столбцы сплошные: под поверхностью нет пустот, над ней — нет висящей земли.
 * Дыра под травой означала бы, что житель провалится, а летающий воксель виден с любого зума.
 */
function checkColumnsSolid(island: GeneratedIsland, report: (message: string) => void): void {
  for (let z = 0; z < WORLD_Z; z += 1) {
    for (let x = 0; x < WORLD_X; x += 1) {
      const column = columnIndex(x, z);
      const surface = island.surfaceY[column] ?? 0;
      const onLand = island.shape.land[column] === 1;

      for (let y = 0; y <= surface; y += 1) {
        if (island.voxels[voxelIndex(x, y, z)] === Material.AIR) {
          report(`дыра под поверхностью в (${String(x)}, ${String(y)}, ${String(z)})`);
          return;
        }
      }

      for (let y = surface + 1; y < WORLD_Y; y += 1) {
        const material = island.voxels[voxelIndex(x, y, z)];
        const expected = !onLand && y <= SEA_LEVEL ? Material.WATER : Material.AIR;
        if (material !== expected) {
          report(`лишний воксель в (${String(x)}, ${String(y)}, ${String(z)})`);
          return;
        }
      }
    }
  }
}

describe('generateIsland — поверхность и вода', () => {
  const island = generateIsland(31);

  it('материал поверхности соответствует биому', () => {
    const expected: Partial<Record<BiomeId, number>> = {
      [Biome.BEACH]: Material.SAND,
      [Biome.ROCKS]: Material.STONE,
      [Biome.MEADOW]: Material.GRASS,
      [Biome.GROVE]: Material.GRASS,
    };

    let mismatches = 0;
    for (let i = 0; i < WORLD_COLUMN_COUNT; i += 1) {
      if (island.shape.land[i] !== 1) continue;
      const want = expected[(island.biomes[i] ?? Biome.MEADOW) as BiomeId];
      if (want === undefined) continue;

      const x = i % WORLD_X;
      const z = (i - x) / WORLD_X;
      const material = island.voxels[voxelIndex(x, island.surfaceY[i] ?? 0, z)];
      // Глина выступает пятнами поверх любого биома — это не расхождение.
      if (material !== want && material !== Material.CLAY) mismatches += 1;
    }

    expect(mismatches).toBe(0);
  });

  it('вода стоит ровно до уровня моря', () => {
    let wrong = 0;
    for (let i = 0; i < WORLD_COLUMN_COUNT; i += 1) {
      if (island.shape.land[i] === 1) continue;
      const x = i % WORLD_X;
      const z = (i - x) / WORLD_X;

      if (island.voxels[voxelIndex(x, SEA_LEVEL, z)] !== Material.WATER) wrong += 1;
      if (island.voxels[voxelIndex(x, SEA_LEVEL + 1, z)] !== Material.AIR) wrong += 1;
    }
    expect(wrong).toBe(0);
  });

  it('суша всегда выше уровня моря', () => {
    let below = 0;
    for (let i = 0; i < WORLD_COLUMN_COUNT; i += 1) {
      if (island.shape.land[i] !== 1) continue;
      if ((island.surfaceY[i] ?? 0) <= SEA_LEVEL) below += 1;
    }
    expect(below).toBe(0);
  });
});

describe('generateIsland — бюджет времени', () => {
  it('остров генерируется быстрее полусекунды', () => {
    // Замер на машине разработки — около 65 мс при бюджете 200 мс (§2 ТЗ).
    // Порог здесь заведомо мягкий: тест ловит обвал производительности, а не колебания CI.
    const started = Date.now();
    generateIsland(777);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
