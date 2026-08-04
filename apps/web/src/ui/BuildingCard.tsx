import {
  buildingType,
  canAfford,
  refundOf,
  upgradeCost,
  type PlacedBuilding,
  type ResourceId,
  type Villager,
} from '@gavan/shared';

import { useGameStore } from '../state/store';
import { amountText, listText, PAUSE_TEXT } from './resourceText';

/**
 * Карточка здания (M4.5): что делает, кто работает, что с ним сейчас.
 *
 * Простой она сообщает строчкой, а не значком тревоги: остановившаяся мастерская —
 * это новость, а не беда (устав, п. 8).
 */
export function BuildingCard(): React.JSX.Element | null {
  const id = useGameStore((state) => state.selectedBuilding);
  const buildings = useGameStore((state) => state.buildings);
  const villagers = useGameStore((state) => state.villagers);
  const resources = useGameStore((state) => state.resources);
  const tick = useGameStore((state) => state.tick);
  const send = useGameStore((state) => state.send);
  const close = useGameStore((state) => state.selectBuilding);
  const startMoving = useGameStore((state) => state.startMoving);
  const setDetached = useGameStore((state) => state.setDetached);

  const building = buildings.find((item) => item.id === id);
  const type = building === undefined ? undefined : buildingType(building.typeId);
  if (building === undefined || type === undefined || id === null) return null;

  const crew = villagers.filter((villager) => building.workers.includes(villager.id));
  const tenants = villagers.filter((villager) => building.residents.includes(villager.id));
  const upgrade = upgradeCost(type, building.level);
  const refund = refundOf(building, type.cost, tick);

  return (
    <aside className="card building-card">
      <header className="card-head">
        <h2 className="card-name">{type.name}</h2>
        <button
          type="button"
          className="card-close"
          onClick={() => {
            close(null);
          }}
        >
          закрыть
        </button>
      </header>

      <p className="card-line">{stateLine(building, type.name)}</p>

      {type.output !== undefined && (
        <p className="card-line">Делает {outputText(type.output)} в час</p>
      )}

      {tenants.length > 0 && <p className="card-line">Здесь ночуют: {names(tenants)}</p>}

      {type.workers > 0 && (
        <p className="card-line">
          {crew.length === 0
            ? 'Работать пока некому'
            : `Работают: ${names(crew)} из ${String(type.workers)}`}
        </p>
      )}

      {crew.map((worker) => (
        <button
          key={worker.id}
          type="button"
          className="card-action card-action-quiet"
          onClick={() => {
            setDetached(worker.id, true);
            send?.({ t: 'assign_job', villagerId: worker.id, buildingId: null });
          }}
        >
          Отпустить {worker.name.split(' ')[0] ?? worker.name}
        </button>
      ))}

      <div className="card-actions">
        {building.level < 3 && building.progress >= 1 && (
          <button
            type="button"
            className="card-action"
            disabled={!canAfford(resources, upgrade)}
            onClick={() => {
              send?.({ t: 'upgrade_building', id });
            }}
          >
            Улучшить — {costText(upgrade)}
          </button>
        )}

        <button
          type="button"
          className="card-action"
          onClick={() => {
            startMoving(id);
            close(null);
          }}
        >
          Перенести — бесплатно
        </button>

        <button
          type="button"
          className="card-action card-action-quiet"
          onClick={() => {
            send?.({ t: 'remove_building', id });
            close(null);
          }}
        >
          Разобрать — вернётся {costText(refund)}
        </button>
      </div>
    </aside>
  );
}

function stateLine(building: PlacedBuilding, name: string): string {
  if (building.progress < 1) {
    return `Строится, готово на ${String(Math.round(building.progress * 100))} процентов`;
  }
  const paused = building.pausedReason;
  if (paused !== undefined) return PAUSE_TEXT[paused] ?? 'Отдыхает';
  return `${name}, уровень ${String(building.level)} — работает`;
}

function outputText(output: Partial<Record<ResourceId, number>>): string {
  const parts = (Object.entries(output) as [ResourceId, number][]).map(([id, amount]) =>
    amountText(id, amount * 6),
  );
  return listText(parts);
}

function costText(cost: Partial<Record<ResourceId, number>>): string {
  const parts = (Object.entries(cost) as [ResourceId, number][])
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => amountText(id, amount));
  return parts.length === 0 ? 'ничего' : listText(parts);
}

function names(villagers: readonly Villager[]): string {
  return listText(villagers.map((villager) => villager.name.split(' ')[0] ?? villager.name));
}
