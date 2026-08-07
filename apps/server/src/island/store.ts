import { randomBytes } from 'node:crypto';

import {
  BASE_STORAGE_CAP,
  buildNavGrid,
  createStartingVillagers,
  createWorldState,
  DEFAULT_SETTINGS,
  findLandingSite,
  findScenicSpots,
  findSpawns,
  fromSnapshot,
  generateIsland,
  Material,
  SNAPSHOT_VERSION,
  type CatchUpEvent,
  type Chapter,
  toSnapshot,
  toVillagerSnapshot,
  TICKS_PER_HOUR,
  voxelIndex,
  type GeneratedIsland,
  type IslandSettings,
  type NavGrid,
  type Vec3,
  type Villager,
  type WorldReader,
  type WorldState,
} from '@gavan/shared';
import { eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { buildings, islands, islandState, villagers as villagerRows } from '../db/schema';

/**
 * Остров на сервере: генерация, чтение и запись (M5.1, M5.3).
 *
 * Мир восстанавливается из сида плюс сохранённой разницы, поэтому в базе лежат килобайты,
 * а тяжёлые массивы вокселей живут только в памяти процесса и считаются заново. Здания
 * и жители дублируются в свои таблицы: по ним ищут, а снимок мира — цельное тело.
 */

/** С какого часа начинается первый день: девять утра (§3 ТЗ). */
export const START_TICK = 9 * TICKS_PER_HOUR;

/** Всё, что нужно, чтобы считать один остров. Держится в памяти, пока остров живой. */
export interface LiveIsland {
  id: string;
  seed: number;
  generated: GeneratedIsland;
  world: WorldState;
  reader: WorldReader;
  grid: NavGrid;
  scenicSpots: Vec3[];
  villagers: Villager[];
  tick: number;
  /** Какая сейчас глава (§7 ТЗ). Назад не откатывается. */
  chapter: Chapter;
  /** Сколько праздников уже было. Веха четвёртой главы. */
  festivals: number;
  /** До какого тика идёт праздник. Пусто — обычный день. */
  festivalUntilTick?: number;
  /** Серверное время последнего расчёта. Только по нему считается догон (§9 ТЗ). */
  lastTickAt: Date;
  /** Настройки, которые задаёт игрок. Пока их ровно одна — семьи (§5 ТЗ). */
  settings: IslandSettings;
  /** Есть ли несохранённые изменения. Запись идёт пачками, а не на каждый тик. */
  dirty: boolean;
  /**
   * Что случилось, пока игрока не было. Читается один раз — тем, кто первым спросит
   * состояние, — и на этом исчезает: экран «Пока тебя не было» показывается однажды.
   */
  pendingCatchUp: CatchUpEvent[] | null;
}

/**
 * Настройки из `meta`. Отдельной колонки ради одного флага заводить незачем, а форма
 * читается с оглядкой: остров мог быть сохранён до того, как настройки появились.
 */
function readSettings(meta: Record<string, unknown>): IslandSettings {
  const stored = meta.settings;
  if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTINGS;
  const families = (stored as { families?: unknown }).families;
  return { families: families === true };
}

/** Короткий код для гостей. Без похожих букв: код диктуют вслух. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeVisitCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? 'A';
  return code;
}

export function makeSeed(): number {
  return randomBytes(4).readUInt32BE(0) % 1_000_000;
}

/** Собирает всё, что нужно для расчёта: воксели, граф проходимости, красивые места. */
export function hydrate(
  id: string,
  seed: number,
  world: WorldState,
  tick: number,
  people: Villager[],
  lastTickAt: Date = new Date(),
  chapter: Chapter = 1,
  settings: IslandSettings = DEFAULT_SETTINGS,
): LiveIsland {
  const generated = generateIsland(seed);

  // Сохранённая разница накладывается на сгенерированный мир — так же, как на клиенте.
  for (const [index, material] of world.edits) generated.voxels[index] = material;

  const reader: WorldReader = {
    material: (x, y, z) => generated.voxels[voxelIndex(x, y, z)] ?? Material.AIR,
  };
  const grid = buildNavGrid(reader);

  return {
    id,
    seed,
    generated,
    world,
    reader,
    grid,
    scenicSpots: findScenicSpots(grid),
    villagers: people,
    tick,
    chapter,
    festivals: 0,
    lastTickAt,
    settings: { ...settings },
    dirty: false,
    pendingCatchUp: null,
  };
}

/** Новый остров: сид, стартовое состояние и четыре жителя (§9 ТЗ). */
export function createIsland(id: string, seed: number): LiveIsland {
  const world = createWorldState(seed);
  const live = hydrate(id, seed, world, START_TICK, []);

  // Четверо стоят там, где причалила лодка (§11 ТЗ). Место считает та же чистая функция,
  // что и сцена прибытия у клиента, — иначе лодка пришла бы в одну бухту, а люди в другую.
  const site = findLandingSite(live.grid, live.generated.shape);
  live.villagers = createStartingVillagers(seed, id, findSpawns(live.grid, 4, site.shore));
  return live;
}

export async function loadIsland(db: Database, id: string): Promise<LiveIsland | null> {
  const rows = await db
    .select()
    .from(islands)
    .innerJoin(islandState, eq(islands.id, islandState.islandId))
    .where(eq(islands.id, id))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const world = fromSnapshot(row.island_state.worldPatch);
  const people = await db.select().from(villagerRows).where(eq(villagerRows.islandId, id));

  return hydrate(
    id,
    row.islands.seed,
    world,
    row.islands.tick,
    people.map((p) => p.data),
    row.islands.lastTickAt,
    row.islands.chapter as Chapter,
    readSettings(row.island_state.meta),
  );
}

/**
 * Записывает остров целиком.
 *
 * Всё одной транзакцией: половина сохранённого мира хуже, чем несохранённый. Здания
 * и жители переписываются полностью — их сотни, а не миллионы, и сверка по одному
 * стоила бы дороже самой записи.
 */
export async function saveIsland(db: Database, live: LiveIsland): Promise<void> {
  const snapshot = toSnapshot(live.world);
  live.lastTickAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(islands)
      .set({ tick: live.tick, chapter: live.chapter, lastTickAt: live.lastTickAt })
      .where(eq(islands.id, live.id));

    await tx
      .update(islandState)
      .set({
        resources: live.world.resources,
        worldPatch: snapshot,
        meta: { settings: live.settings },
        version: SNAPSHOT_VERSION,
        updatedAt: new Date(),
      })
      .where(eq(islandState.islandId, live.id));

    await tx.delete(villagerRows).where(eq(villagerRows.islandId, live.id));
    if (live.villagers.length > 0) {
      await tx.insert(villagerRows).values(
        live.villagers.map((villager) => ({
          id: villager.id,
          islandId: live.id,
          data: toVillagerSnapshot(villager),
        })),
      );
    }

    await tx.delete(buildings).where(eq(buildings.islandId, live.id));
    if (live.world.buildings.length > 0) {
      await tx.insert(buildings).values(
        live.world.buildings.map((building) => ({
          id: building.id,
          islandId: live.id,
          typeId: building.typeId,
          x: building.x,
          y: building.y,
          z: building.z,
          rot: building.rotation,
          level: building.level,
          progress: building.progress,
          data: {
            workers: building.workers,
            residents: building.residents,
            ...(building.builtAtTick === undefined ? {} : { builtAtTick: building.builtAtTick }),
            ...(building.pausedReason === undefined ? {} : { pausedReason: building.pausedReason }),
          },
        })),
      );
    }
  });

  live.dirty = false;
}

/** Заводит остров в базе вместе с его первым состоянием. */
export async function insertIsland(
  db: Database,
  ownerId: string,
  name: string,
  live: LiveIsland,
  visitCode: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(islands).values({
      id: live.id,
      ownerId,
      name,
      seed: live.seed,
      visitCode,
      tick: live.tick,
    });

    await tx.insert(islandState).values({
      islandId: live.id,
      resources: live.world.resources,
      worldPatch: toSnapshot(live.world),
      version: SNAPSHOT_VERSION,
    });

    await tx.insert(villagerRows).values(
      live.villagers.map((villager) => ({
        id: villager.id,
        islandId: live.id,
        data: toVillagerSnapshot(villager),
      })),
    );
  });
}

export { BASE_STORAGE_CAP };
