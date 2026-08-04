import { autoAssignments, economyTick, type ResourceNode, type Villager } from '@gavan/shared';

import type { CommandBus } from '../net/commands';
import type { LiveWorld } from '../state/liveWorld';
import { useGameStore } from '../state/store';

/**
 * Ход хозяйства на клиенте: стройка, производство и залежи (M4.3, M4.4).
 *
 * Это не команда игрока, а собственные часы мира, поэтому результат применяется напрямую
 * и не попадает в историю отмены: откатывать вчерашний урожай нечестно и незачем.
 * Считает та же чистая функция, которую на M5 будет крутить сервер, — расхождению взяться
 * неоткуда.
 *
 * Автоназначение работы и жилья — наоборот, обычные команды: они меняют мир, а мир меняется
 * только командами.
 */
export class EconomyDriver {
  constructor(
    private readonly world: LiveWorld,
    private readonly bus: CommandBus,
    private readonly nodes: readonly ResourceNode[],
    private readonly onBuildingsChanged: () => void,
  ) {}

  /** Один хозяйственный тик. Вызывается тогда же, когда тик уходит в симуляцию жителей. */
  step(tick: number, hour: number, villagers: readonly Villager[]): void {
    const effect = economyTick(this.world.state, {
      villagers,
      hour,
      tick,
      nodes: this.nodes,
    });

    const changed = effect.buildings.length > 0 || effect.nodes.length > 0;
    if (changed || Object.keys(effect.resources).length > 0) this.world.applyEffect(effect);
    if (effect.buildings.length > 0) this.onBuildingsChanged();

    const detached = new Set(useGameStore.getState().detachedWorkers);
    for (const command of autoAssignments(this.world.state, villagers, { detached })) {
      void this.bus.run(command);
    }

    publishEconomy(this.world);
  }
}

/** Кладёт снимок хозяйства в стор, откуда его читает интерфейс. */
export function publishEconomy(world: LiveWorld): void {
  const state = world.state;
  useGameStore
    .getState()
    .setEconomy({ ...state.resources }, state.storageCap, [...state.buildings]);
}
