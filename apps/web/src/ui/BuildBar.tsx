import {
  BUILDINGS,
  canAfford,
  type BuildingCategory,
  type BuildingType,
  type ResourceId,
} from '@gavan/shared';
import { useState } from 'react';

import { useGameStore } from '../state/store';
import { amountText, listText } from './resourceText';

/**
 * Панель строительства (M4.2): категории сверху, здания под ними.
 *
 * Недоступное здание не прячется и не гаснет наглухо — оно показано с ценой, чтобы было
 * видно, к чему идти. Ни одного технического сообщения: цена и есть объяснение.
 */

const CATEGORY_LABEL: Record<BuildingCategory, string> = {
  home: 'жильё',
  gather: 'добыча',
  craft: 'мастерские',
  utility: 'быт',
  culture: 'культура',
  decor: 'уют',
};

const CATEGORIES: readonly BuildingCategory[] = [
  'home',
  'gather',
  'craft',
  'utility',
  'culture',
  'decor',
];

export function BuildBar(): React.JSX.Element | null {
  const mode = useGameStore((state) => state.mode);
  const chosen = useGameStore((state) => state.buildTypeId);
  const choose = useGameStore((state) => state.chooseBuilding);
  const resources = useGameStore((state) => state.resources);
  const buildings = useGameStore((state) => state.buildings);
  const rotation = useGameStore((state) => state.buildRotation);
  const guest = useGameStore((state) => state.guest);
  const touch = useGameStore((state) => state.touch);

  const [category, setCategory] = useState<BuildingCategory>('home');

  // В гостях панели нет вовсе: read-only означает read-only (§9 ТЗ).
  if (guest || mode !== 'build') return null;

  const available = BUILDINGS.filter((type) => type.category === category);
  const built = new Set(buildings.filter((b) => b.progress >= 1).map((b) => b.typeId));

  return (
    <div className="build-bar">
      <div className="build-tabs">
        {CATEGORIES.map((id) => (
          <button
            key={id}
            type="button"
            className={id === category ? 'build-tab build-tab-on' : 'build-tab'}
            onClick={() => {
              setCategory(id);
            }}
          >
            {CATEGORY_LABEL[id]}
          </button>
        ))}
      </div>

      <div className="build-list">
        {available.map((type) => (
          <BuildingButton
            key={type.id}
            type={type}
            chosen={type.id === chosen}
            affordable={canAfford(resources, type.cost)}
            locked={type.requires.filter((id) => !built.has(id))}
            onChoose={() => {
              choose(type.id === chosen ? null : type.id);
            }}
          />
        ))}
      </div>

      {touch ? (
        <TouchBuildControls chosen={chosen} rotation={rotation} />
      ) : (
        <p className="build-hint">
          {chosen === null
            ? 'Выбери, что построить. Здание можно повернуть и перенести — это бесплатно'
            : `Поворот R · сейчас ${String(rotation * 90)}° · Escape чтобы передумать`}
        </p>
      )}
    </div>
  );
}

/**
 * Строительство пальцем (§8 ТЗ, мобильное управление).
 *
 * Здание не ставится касанием по острову: палец закрывает как раз то место, куда целятся,
 * и промах был бы правилом, а не исключением. Палец водит призрак, а ставит — кнопка.
 */
function TouchBuildControls({
  chosen,
  rotation,
}: {
  chosen: string | null;
  rotation: 0 | 1 | 2 | 3;
}): React.JSX.Element {
  const rotate = useGameStore((state) => state.rotateBuild);
  const confirm = useGameStore((state) => state.confirmBuild);
  const moving = useGameStore((state) => state.movingBuildingId);
  const cancel = useGameStore((state) => state.setMode);

  if (chosen === null && moving === null) {
    return <p className="build-hint">Выбери, что построить, — потом веди пальцем по острову</p>;
  }

  return (
    <div className="build-touch">
      <button
        type="button"
        className="build-touch-button"
        onClick={rotate}
        aria-label={`Повернуть, сейчас ${String(rotation * 90)} градусов`}
      >
        повернуть {rotation * 90}°
      </button>

      <button
        type="button"
        className="build-touch-button build-touch-main"
        onClick={() => {
          confirm?.();
        }}
      >
        поставить сюда
      </button>

      <button
        type="button"
        className="build-touch-button"
        onClick={() => {
          cancel('look');
        }}
      >
        передумать
      </button>
    </div>
  );
}

function BuildingButton(props: {
  type: BuildingType;
  chosen: boolean;
  affordable: boolean;
  locked: readonly string[];
  onChoose: () => void;
}): React.JSX.Element {
  const { type, chosen, affordable, locked, onChoose } = props;

  const classes = ['build-item'];
  if (chosen) classes.push('build-item-on');
  if (!affordable || locked.length > 0) classes.push('build-item-far');

  return (
    <button type="button" className={classes.join(' ')} onClick={onChoose} title={type.description}>
      <span className="build-name">{type.name}</span>
      <span className="build-cost">{costText(type.cost)}</span>
      {locked.length > 0 && <span className="build-locked">{lockText(locked)}</span>}
    </button>
  );
}

function costText(cost: Partial<Record<ResourceId, number>>): string {
  const parts = (Object.entries(cost) as [ResourceId, number][]).map(([id, amount]) =>
    amountText(id, amount),
  );
  return parts.length === 0 ? 'ничего не стоит' : listText(parts);
}

function lockText(locked: readonly string[]): string {
  const names = locked.map((id) => BUILDINGS.find((type) => type.id === id)?.name ?? id);
  return `появится после: ${names.join(', ').toLowerCase()}`;
}
