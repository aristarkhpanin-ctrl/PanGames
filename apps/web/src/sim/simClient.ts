import {
  REAL_SECONDS_PER_GAME_HOUR,
  type PlacedBuilding,
  type PlantInstance,
  type Villager,
} from '@gavan/shared';

import type { SimIncoming, SimSnapshot } from './sim.worker';

/**
 * Связь с воркером симуляции.
 *
 * Тик — 10 реальных секунд (§3 ТЗ), а кадров за это время шестьсот. Поэтому клиент хранит
 * два последних снимка и рисует жителя между ними: движение выходит плавным, хотя решения
 * принимаются редко.
 */

/** Реальных секунд между тиками (§3 ТЗ). */
export const SECONDS_PER_TICK = (REAL_SECONDS_PER_GAME_HOUR / 60) * 10;

export class SimClient {
  private readonly worker: Worker;
  private previous: Villager[] = [];
  private current: Villager[] = [];
  private sinceTick = 0;
  private currentTick = 0;
  private onSnapshot: ((villagers: readonly Villager[]) => void) | null = null;

  constructor(voxels: Uint8Array, seed: number, islandId: string, startTick = 0) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (event: MessageEvent<SimSnapshot>): void => {
      this.previous = this.current.length > 0 ? this.current : event.data.villagers;
      this.current = event.data.villagers;
      this.sinceTick = 0;
      this.onSnapshot?.(this.current);
    };

    this.currentTick = startTick;
    const copy = voxels.slice();
    const init: SimIncoming = {
      type: 'init',
      voxels: copy.buffer,
      seed,
      islandId,
      tick: startTick,
    };
    this.worker.postMessage(init, [copy.buffer]);
  }

  subscribe(handler: (villagers: readonly Villager[]) => void): void {
    this.onSnapshot = handler;
  }

  /** Держит копию мира в воркере в согласии с главным потоком. */
  applyEdits(indices: Uint32Array, materials: Uint8Array): void {
    const message: SimIncoming = {
      type: 'edit',
      indices: indices.slice(),
      materials: materials.slice(),
    };
    this.worker.postMessage(message);
  }

  /**
   * Здания и растения нужны воркеру, чтобы житель знал, куда идти спать и где работать.
   * Отправляются целиком при каждом изменении: их сотни, а не тысячи.
   */
  setWorld(buildings: readonly PlacedBuilding[], plants: readonly PlantInstance[]): void {
    const message: SimIncoming = {
      type: 'world',
      buildings: buildings.map((building) => ({ ...building })),
      plants: plants.map((plant) => ({ x: plant.x, z: plant.z })),
    };
    this.worker.postMessage(message);
  }

  /**
   * Двигает время. Возвращает долю пути до следующего тика — по ней идёт сглаживание.
   * `onTick` вызывается в тот же момент, когда тик уходит в воркер: хозяйство и жители
   * должны считать один и тот же тик, а не разъезжаться на полсекунды.
   */
  update(deltaSeconds: number, onTick?: (tick: number) => void): number {
    this.sinceTick += deltaSeconds;
    if (this.sinceTick >= SECONDS_PER_TICK) {
      this.sinceTick -= SECONDS_PER_TICK;
      this.currentTick += 1;
      const step: SimIncoming = { type: 'tick' };
      this.worker.postMessage(step);
      onTick?.(this.currentTick);
    }
    return Math.min(this.sinceTick / SECONDS_PER_TICK, 1);
  }

  /** Текущий тик мира. По нему считаются возврат при разборке и время суток. */
  get tick(): number {
    return this.currentTick;
  }

  get villagers(): readonly Villager[] {
    return this.current;
  }

  get previousVillagers(): readonly Villager[] {
    return this.previous;
  }

  dispose(): void {
    this.worker.terminate();
  }
}
