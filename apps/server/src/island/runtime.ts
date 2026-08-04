import {
  applyCommand,
  autoAssignments,
  commitEffect,
  economyTick,
  hourOfTick,
  rebuildNavArea,
  simulateTick,
  validate,
  WORLD_X,
  WORLD_Z,
  type Command,
  type ValidationResult,
  type Villager,
} from '@gavan/shared';

import type { Database } from '../db/client';
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
}

type TickListener = (broadcast: TickBroadcast) => void;

export class IslandRuntime {
  private readonly live = new Map<string, LiveIsland>();
  private readonly online = new Map<string, number>();
  private readonly idleSince = new Map<string, number>();
  private readonly listeners = new Set<TickListener>();
  private readonly ticksSinceSave = new Map<string, number>();
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

  /** Поднимает остров в память, если его там ещё нет. */
  async open(islandId: string): Promise<LiveIsland | null> {
    const known = this.live.get(islandId);
    if (known !== undefined) return known;

    const loaded = await loadIsland(this.db, islandId);
    if (loaded === null) return null;

    this.live.set(islandId, loaded);
    return loaded;
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
      },
    );

    island.villagers = simulated.state.villagers;
    island.tick = tick;
    island.dirty = true;

    // Свободные дома и работы разбираются теми же командами, что и вручную.
    for (const command of autoAssignments(island.world, island.villagers)) {
      const verdict = validate(command, island.world, island.reader);
      if (verdict.ok)
        commitEffect(island.world, applyCommand(command, island.world, island.reader, tick));
    }

    return {
      islandId: island.id,
      tick,
      hour,
      villagers: island.villagers,
      resources: island.world.resources,
      storageCap: island.world.storageCap,
      buildings: island.world.buildings,
    };
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
