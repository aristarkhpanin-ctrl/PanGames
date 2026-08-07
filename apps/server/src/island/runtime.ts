import {
  applyCommand,
  autoAssignments,
  catchUp,
  chapterInfo,
  commitEffect,
  createStartingVillagers,
  comfortAt,
  expectingHome,
  grewUpThisTick,
  newborn,
  isChild,
  BIRTH_EVERY_TICKS,
  type Expecting,
  FESTIVAL_TICKS,
  nextChapter,
  SHELLS_PER_COMFORT_TICK,
  totalBeds,
  economyTick,
  hourOfTick,
  rebuildNavArea,
  simulateTick,
  validate,
  WORLD_X,
  WORLD_Z,
  type CatchUpEvent,
  type Chapter,
  type Command,
  type ValidationResult,
  type Villager,
} from '@gavan/shared';

import { journal } from '../db/schema';
import type { Database } from '../db/client';
import { Chronicle, type ChronicleEntry } from './chronicle';
import { loadIsland, saveIsland, type LiveIsland } from './store';

/**
 * Живая симуляция острова (M5.4, M5.5).
 *
 * Считает ровно тот же код, что и клиент: `validate`, `applyCommand`, `economyTick`,
 * `simulateTick` — всё из `shared`. Ни одной ветки логики, повторяющей клиентскую, здесь
 * нет и быть не должно: расхождение означало бы, что игрок видит одно, а получает другое.
 *
 * Тикают только острова, на которых кто-то есть (§12 ТЗ). Пустой остров не стоит процессору
 * ничего — и это не оптимизация на будущее, а условие того, чтобы один процесс тянул тысячи
 * островов.
 */

/** Реальных секунд между тиками (§3 ТЗ). */
export const TICK_INTERVAL_MS = 10_000;

/** Как часто мир уходит в базу. Чаще незачем: тик и так раз в десять секунд. */
const SAVE_EVERY_TICKS = 6;

/** Сколько остров живёт в памяти после ухода последнего игрока. */
const KEEP_ALIVE_MS = 60_000;

/** Потолок команд в секунду на пользователя (§9 ТЗ). */
export const COMMANDS_PER_SECOND = 30;

/** Сколько жителей помещается на острове (§5 ТЗ). */
const MAX_VILLAGERS = 60;

/** Какой средний уют нужен, чтобы к вам захотелось приплыть. */
const COMFORT_TO_ATTRACT = 6;

/** Как часто вообще может кто-то приплыть. Раз в игровой день, не чаще. */
const ARRIVAL_EVERY_TICKS = 144;

export interface CommandOutcome {
  index: number;
  result: ValidationResult;
}

export interface TickBroadcast {
  islandId: string;
  tick: number;
  hour: number;
  villagers: Villager[];
  resources: Record<string, number>;
  storageCap: number;
  buildings: LiveIsland['world']['buildings'];
  /** Новые записи дневника за этот тик. Обычно пусто. */
  journal: ChronicleEntry[];
  /** Новая глава, если она наступила прямо сейчас. Показывается один раз (§7 ТЗ). */
  chapter?: { number: Chapter; name: string };
}

/** Средний уют по жилью: от него зависят главы и приход новых жителей. */
function averageComfort(island: LiveIsland): number {
  const homes = island.world.buildings.filter(
    (building) => building.progress >= 1 && building.residents.length > 0,
  );
  if (homes.length === 0) return 0;

  const children = childrenNear(island);
  let sum = 0;
  for (const home of homes) {
    sum += comfortAt(home, island.world.buildings, island.world.plants, children);
  }
  return sum / homes.length;
}

/** Где сейчас дети. Уют от ребёнка ходит вместе с ним (§5 ТЗ). */
function childrenNear(island: LiveIsland): { x: number; z: number }[] {
  return island.villagers
    .filter((villager) => isChild(villager, island.tick))
    .map((villager) => ({ x: villager.position.x, z: villager.position.z }));
}

type TickListener = (broadcast: TickBroadcast) => void;

export class IslandRuntime {
  private readonly live = new Map<string, LiveIsland>();
  private readonly online = new Map<string, number>();
  private readonly idleSince = new Map<string, number>();
  private readonly listeners = new Set<TickListener>();
  private readonly chronicle = new Chronicle();
  private readonly ticksSinceSave = new Map<string, number>();
  /**
   * Острова, которые прямо сейчас поднимаются. Без этого два одновременных запроса
   * прочитали бы одно и то же `lastTickAt` и начислили догон дважды.
   */
  private readonly opening = new Map<string, Promise<LiveIsland | null>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Database) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tickAll();
    }, TICK_INTERVAL_MS);
    // Тик не должен держать процесс живым: без игроков сервер обязан спокойно закрываться.
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;

    // Ничего не теряем на выключении: несохранённое дописывается перед уходом.
    for (const island of this.live.values()) {
      if (island.dirty) await saveIsland(this.db, island);
    }
    this.live.clear();
  }

  onTick(listener: TickListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Поднимает остров в память и досчитывает то, что случилось без игрока (M6.2).
   *
   * Догон считается ровно один раз: остров, который уже в памяти, не досчитывается повторно,
   * а два одновременных запроса делят один и тот же подъём. Время берётся только серверное —
   * из браузера его не подкрутить (§9 ТЗ).
   */
  async open(islandId: string): Promise<LiveIsland | null> {
    const known = this.live.get(islandId);
    if (known !== undefined) return known;

    const already = this.opening.get(islandId);
    if (already !== undefined) return already;

    const loading = this.load(islandId).finally(() => {
      this.opening.delete(islandId);
    });
    this.opening.set(islandId, loading);
    return loading;
  }

  private async load(islandId: string): Promise<LiveIsland | null> {
    const loaded = await loadIsland(this.db, islandId);
    if (loaded === null) return null;

    const absenceMs = Date.now() - loaded.lastTickAt.getTime();
    const result = catchUp({
      world: loaded.world,
      villagers: loaded.villagers,
      nodes: loaded.generated.resourceNodes,
      reader: loaded.reader,
      fromTick: loaded.tick,
      absenceMs,
    });

    if (result.gameHours > 0) {
      loaded.world = result.world;
      loaded.villagers = result.villagers;
      loaded.tick = result.tick;
      loaded.pendingCatchUp = result.events;
      // Запись сразу: пока догон не в базе, повторный подъём начислил бы его ещё раз.
      await saveIsland(this.db, loaded);
    }

    this.live.set(islandId, loaded);
    return loaded;
  }

  /**
   * Гость оставил подарок: остров узнаёт об этом записью в дневнике и цветком на берегу
   * (§9 ТЗ). Уведомление владельцу — доброе и редкое, без «вернись скорее» (устав, п. 9).
   */
  noteGift(islandId: string, guest: string): void {
    const island = this.live.get(islandId);
    if (island === undefined) return;

    const name = guest.split('@')[0] ?? 'кто-то';
    void this.saveEntries(islandId, [this.chronicle.giftEntry(island, name)]);

    // След визита: цветок на берегу. Владелец может пересадить его, но не потерять.
    const spot = island.scenicSpots[island.tick % Math.max(1, island.scenicSpots.length)];
    if (spot === undefined) return;

    island.world.plants.push({
      id: `plant-${String(island.world.nextPlantId)}`,
      kind: 'flower_pink',
      x: spot.x,
      y: spot.y - 1,
      z: spot.z,
      seed: island.seed + island.tick,
    });
    island.world.nextPlantId += 1;
    island.dirty = true;
  }

  /** Отдаёт результат догона один раз: экран «Пока тебя не было» показывается однажды. */
  takeCatchUp(island: LiveIsland): CatchUpEvent[] | null {
    const events = island.pendingCatchUp;
    island.pendingCatchUp = null;
    return events;
  }

  /** Кладёт уже собранный остров в память — сразу после создания, без лишнего чтения. */
  put(island: LiveIsland): void {
    this.live.set(island.id, island);
  }

  join(islandId: string): void {
    this.online.set(islandId, (this.online.get(islandId) ?? 0) + 1);
    this.idleSince.delete(islandId);
  }

  leave(islandId: string): void {
    const left = (this.online.get(islandId) ?? 1) - 1;
    if (left <= 0) {
      this.online.delete(islandId);
      this.idleSince.set(islandId, Date.now());
    } else {
      this.online.set(islandId, left);
    }
  }

  /**
   * Забывает остров, не сохраняя. Нужно тестам, чтобы проверить подъём с догоном,
   * и выключению, когда остров уже записан.
   */
  forget(islandId: string): void {
    this.live.delete(islandId);
    this.ticksSinceSave.delete(islandId);
  }

  playersOn(islandId: string): number {
    return this.online.get(islandId) ?? 0;
  }

  get liveCount(): number {
    return this.live.size;
  }

  /**
   * Исполняет пакет команд (§9 ТЗ: единственная точка мутации).
   *
   * Пакет применяется целиком или не применяется вовсе — так же, как транзакция в базе.
   * Половина принятых команд оставила бы игрока с миром, которого он не просил, и объяснить
   * ему это было бы нечем.
   */
  run(island: LiveIsland, commands: readonly Command[]): CommandOutcome[] {
    const outcomes: CommandOutcome[] = [];
    const applied: ReturnType<typeof applyCommand>[] = [];

    for (const [index, command] of commands.entries()) {
      const verdict = validate(command, island.world, island.reader);
      outcomes.push({ index, result: verdict });
      if (!verdict.ok) continue;

      const effect = applyCommand(command, island.world, island.reader, island.tick);
      commitEffect(island.world, effect);
      applied.push(effect);

      // Праздник живёт в тике, а команда лишь назначает вечер (§7 ТЗ).
      if (command.t === 'host_festival') {
        island.festivalUntilTick = island.tick + FESTIVAL_TICKS;
        island.festivals += 1;
        void this.saveEntries(island.id, [this.chronicle.festivalEntry(island)]);
      }

      for (const change of effect.voxels) island.generated.voxels[change.index] = change.material;
    }

    if (applied.length > 0) {
      island.dirty = true;
      this.refreshNavigation(island, applied);
    }

    return outcomes;
  }

  /** Один шаг мира: хозяйство, жители, назначения. Всё — общим кодом. */
  step(island: LiveIsland): TickBroadcast {
    const tick = island.tick + 1;
    const hour = hourOfTick(tick);

    const economy = economyTick(island.world, {
      villagers: island.villagers,
      hour,
      tick,
      nodes: island.generated.resourceNodes,
    });
    commitEffect(island.world, economy);

    const simulated = simulateTick(
      { tick: island.tick, villagers: island.villagers },
      {
        grid: island.grid,
        scenicSpots: island.scenicSpots,
        seed: island.seed,
        buildings: island.world.buildings,
        plants: island.world.plants,
        ...(island.festivalUntilTick === undefined
          ? {}
          : { festivalUntilTick: island.festivalUntilTick }),
      },
    );

    island.villagers = simulated.state.villagers;
    island.tick = tick;
    island.dirty = true;

    const entries = this.chronicle.fromTick(island, simulated.events);

    // Ракушки жители дают «за просто хорошую жизнь» (§4 ТЗ) — и это заодно страховка
    // от тупика: даже остров, у которого кончилось всё, копит на первую покупку у лодки.
    const comfort = averageComfort(island);
    if (comfort > 0) {
      island.world.resources.shell = Math.min(
        island.world.storageCap,
        island.world.resources.shell + comfort * SHELLS_PER_COMFORT_TICK,
      );
    }

    // Достроенное здание — событие для дневника, а не строка в логе.
    for (const change of economy.buildings) {
      const before = change.before?.progress ?? 1;
      const after = change.after?.progress ?? 0;
      if (before < 1 && after >= 1 && change.after !== undefined) {
        entries.push(this.chronicle.builtEntry(island, change.after.typeId));
      }
    }

    // Свободные дома и работы разбираются теми же командами, что и вручную.
    for (const command of autoAssignments(island.world, island.villagers, { tick: island.tick })) {
      const verdict = validate(command, island.world, island.reader);
      if (!verdict.ok) continue;

      commitEffect(island.world, applyCommand(command, island.world, island.reader, tick));

      if (command.t !== 'assign_home' && command.t !== 'assign_job') continue;
      const who = island.villagers.find((person) => person.id === command.villagerId);
      if (who === undefined) continue;
      if (command.t === 'assign_home') entries.push(this.chronicle.settledEntry(island, who));
      if (command.t === 'assign_job' && command.buildingId !== null) {
        entries.push(this.chronicle.hiredEntry(island, who));
      }
    }

    // Новые жители приплывают сами, когда есть где жить и вокруг хорошо (§5 ТЗ).
    const newcomer = this.welcomeNewcomer(island);
    if (newcomer !== null) entries.push(this.chronicle.arrivalEntry(island, newcomer));

    const expecting = this.maybeBorn(island);
    if (expecting !== null) entries.push(this.chronicle.bornEntry(island, expecting.parents));

    // Взросление не событие, а срок: ребёнок просто перестаёт им быть.
    for (const villager of island.villagers) {
      if (grewUpThisTick(villager, island.tick)) {
        entries.push(this.chronicle.grewUpEntry(island, villager));
      }
    }

    const chapter = this.advanceChapter(island, entries);

    if (entries.length > 0) void this.saveEntries(island.id, entries);

    return {
      islandId: island.id,
      tick,
      hour,
      villagers: island.villagers,
      resources: island.world.resources,
      storageCap: island.world.storageCap,
      buildings: island.world.buildings,
      journal: entries,
      ...(chapter === null ? {} : { chapter }),
    };
  }

  /**
   * Ребёнок появляется сам — и только если игрок включил семьи (§5 ТЗ, устав п. 4).
   *
   * Ни очереди, ни таймера, ни «условия не выполнены»: не сложилось — не случилось ничего.
   * Условия читаются как описание хорошей жизни, а не как список требований.
   */
  private maybeBorn(island: LiveIsland): Expecting | null {
    if (!island.settings.families) return null;
    if (island.villagers.length >= MAX_VILLAGERS) return null;
    if (island.tick % BIRTH_EVERY_TICKS !== 0) return null;

    const expecting = expectingHome(island.villagers, island.world.buildings, (pos) =>
      comfortAt(pos, island.world.buildings, island.world.plants, childrenNear(island)),
    );
    if (expecting === null) return null;

    const baby = newborn(
      island.seed + island.tick * 7919 + island.villagers.length,
      island.id,
      `villager-${String(island.villagers.length + island.tick)}`,
      expecting,
      island.tick,
    );
    if (baby === null) return null;

    island.villagers = [...island.villagers, baby];
    return expecting;
  }

  /**
   * Новый житель приплывает сам, когда есть свободное жильё и вокруг хорошо (§5 ТЗ).
   *
   * Не нанимается и не покупается: приходит, потому что тут хорошо. Появление всегда
   * сопровождается записью — кто это и почему приплыл.
   */
  private welcomeNewcomer(island: LiveIsland): Villager | null {
    if (island.villagers.length >= MAX_VILLAGERS) return null;
    if (totalBeds(island.world.buildings) <= island.villagers.length) return null;
    if (averageComfort(island) < COMFORT_TO_ATTRACT) return null;
    if (island.tick % ARRIVAL_EVERY_TICKS !== 0) return null;

    const spawn = island.scenicSpots[island.tick % Math.max(1, island.scenicSpots.length)];
    if (spawn === undefined) return null;

    // Житель делается тем же кодом, что и стартовые: имя, черты и внешность из сида.
    const [newcomer] = createStartingVillagers(
      island.seed + island.villagers.length * 7919,
      island.id,
      [spawn],
    );
    if (newcomer === undefined) return null;

    const unique: Villager = {
      ...newcomer,
      id: `villager-${String(island.villagers.length + island.tick)}`,
      arrivedAtTick: island.tick,
    };

    island.villagers = [...island.villagers, unique];
    return unique;
  }

  /** Глава наступает по вехе и не откатывается назад (§7 ТЗ). */
  private advanceChapter(
    island: LiveIsland,
    entries: ChronicleEntry[],
  ): { number: Chapter; name: string } | null {
    const earned = nextChapter(island.chapter, {
      villagers: island.villagers,
      buildings: island.world.buildings,
      resources: island.world.resources,
      festivals: island.festivals,
      comfort: averageComfort(island),
    });

    if (earned === island.chapter) return null;

    island.chapter = earned;
    entries.push(this.chronicle.chapterEntry(island, earned));
    return { number: earned, name: chapterInfo(earned).name };
  }

  private async saveEntries(islandId: string, entries: readonly ChronicleEntry[]): Promise<void> {
    await this.db.insert(journal).values(
      entries.map((entry) => ({
        islandId,
        kind: entry.kind,
        text: entry.text,
        actors: entry.actors,
      })),
    );
  }

  private async tickAll(): Promise<void> {
    const now = Date.now();

    for (const [id, island] of this.live) {
      if (this.playersOn(id) === 0) {
        // Остров без игроков не считается вовсе: догон посчитается на M6, когда игрок вернётся.
        const idle = this.idleSince.get(id);
        if (idle !== undefined && now - idle > KEEP_ALIVE_MS) {
          if (island.dirty) await saveIsland(this.db, island);
          this.live.delete(id);
          this.idleSince.delete(id);
          this.ticksSinceSave.delete(id);
        }
        continue;
      }

      const broadcast = this.step(island);
      for (const listener of this.listeners) listener(broadcast);

      const since = (this.ticksSinceSave.get(id) ?? 0) + 1;
      if (since >= SAVE_EVERY_TICKS) {
        this.ticksSinceSave.set(id, 0);
        await saveIsland(this.db, island);
      } else {
        this.ticksSinceSave.set(id, since);
      }
    }
  }

  /**
   * Граф проходимости пересчитывается только вокруг правки — так же, как в воркере клиента.
   * Полная перестройка стоит десятки миллисекунд и на каждую лопату непозволительна.
   */
  private refreshNavigation(
    island: LiveIsland,
    effects: readonly ReturnType<typeof applyCommand>[],
  ): void {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;

    for (const effect of effects) {
      for (const change of effect.voxels) {
        const x = change.index % WORLD_X;
        const z = Math.floor(change.index / WORLD_X) % WORLD_Z;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }

    if (!Number.isFinite(minX)) return;
    rebuildNavArea(island.grid, island.reader, minX - 1, minZ - 1, maxX + 1, maxZ + 1);
  }
}
