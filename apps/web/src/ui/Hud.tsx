import { materialColor, PLANTS, type Villager } from '@gavan/shared';
import { useEffect } from 'react';

import { FILL_MATERIALS } from '../input/editing';
import { BuildBar } from './BuildBar';
import { BuildingCard } from './BuildingCard';
import { ResourceBar } from './ResourceBar';
import { SignIn } from './SignIn';
import { VillagerCard, VillagerColumn } from './VillagerCard';
import { useGameStore, type EditMode } from '../state/store';

/**
 * HUD живёт поверх канваса и знает про сцену ровно ничего — только то, что лежит в сторе.
 * Настоящий интерфейс появляется вместе с игрой (M3.5 и M4.5); пока здесь режим лопаты.
 *
 * Тон текстов — §8 ТЗ: активный залог, сентенс-кейс, без восклицаний.
 */

const MODE_LABEL: Record<EditMode, string> = {
  look: 'Смотрю',
  dig: 'Копаю',
  fill: 'Насыпаю',
  plant: 'Сажаю',
  build: 'Строю',
};

const FILL_LABEL = ['землю', 'песок', 'камень', 'дорожку'];

/** Сколько тихая строка держится на экране. */
const NOTICE_MS = 4000;

export function Hud(): React.JSX.Element {
  const worldReady = useGameStore((state) => state.worldReady);
  const mode = useGameStore((state) => state.mode);
  const brush = useGameStore((state) => state.brush);
  const fillIndex = useGameStore((state) => state.fillIndex);
  const plantIndex = useGameStore((state) => state.plantIndex);
  const villagers = useGameStore((state) => state.villagers);
  const selectedId = useGameStore((state) => state.selectedVillager);
  const buildings = useGameStore((state) => state.buildings);
  const moving = useGameStore((state) => state.movingBuildingId);
  const session = useGameStore((state) => state.session);
  const serverStatus = useGameStore((state) => state.serverStatus);
  const notice = useGameStore((state) => state.notice);
  const noticeAt = useGameStore((state) => state.noticeAt);
  const setNotice = useGameStore((state) => state.setNotice);

  // Строка гаснет сама. Своей копии состояния здесь нет: стор и есть источник правды,
  // а зеркало в локальном состоянии только плодит лишние отрисовки.
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice, noticeAt, setNotice]);

  const selected = villagers.find((villager) => villager.id === selectedId);
  const plant = PLANTS[plantIndex % PLANTS.length];
  const fillName = FILL_LABEL[fillIndex % FILL_LABEL.length] ?? 'землю';
  const fillColor = FILL_MATERIALS[fillIndex % FILL_MATERIALS.length];

  if (session === undefined) return <></>;
  if (session === null) return <SignIn />;

  return (
    <>
      <div className="hud-corner">
        <h1 className="hud-title">Гавань</h1>
        <p className="hud-note">{openingLine(worldReady, buildings.length, villagers)}</p>
        {worldReady && <ResourceBar />}
      </div>

      <VillagerColumn villagers={villagers} />
      {selected !== undefined && <VillagerCard villager={selected} />}
      <BuildingCard />
      <BuildBar />

      <div className="hud-tools" role="status">
        <span className="hud-mode">{MODE_LABEL[mode]}</span>

        {mode === 'fill' && (
          <span className="hud-choice">
            <i
              className="hud-swatch"
              style={{ background: `#${(fillColor ?? 0).toString(16).padStart(6, '0')}` }}
            />
            {fillName}
          </span>
        )}

        {mode === 'plant' && plant !== undefined && (
          <span className="hud-choice">
            <i
              className="hud-swatch"
              style={{
                background: `#${materialColor(plant.material).toString(16).padStart(6, '0')}`,
              }}
            />
            {plant.name.toLowerCase()}
          </span>
        )}

        {(mode === 'dig' || mode === 'fill') && (
          <span className="hud-choice">{brush === 0 ? 'одна клетка' : 'три на три'}</span>
        )}

        {moving !== null && <span className="hud-choice">переносим — это бесплатно</span>}

        <span className="hud-hint">
          1 смотреть · 2 копать · 3 насыпать · 4 сажать · 5 строить
          {mode === 'fill' && ' · X материал · B кисть'}
          {mode === 'plant' && ' · C растение'}
          {mode === 'dig' && ' · B кисть'}
          {mode === 'build' && ' · R повернуть'}
          {' · Ctrl+Z отменить'}
        </span>
      </div>

      {serverStatus === 'unreachable' && (
        <p className="hud-link" role="status">
          Связь пропала. Остров на месте, всё вернётся само
        </p>
      )}

      {notice !== null && <p className="hud-notice">{notice}</p>}
    </>
  );
}

/**
 * Первая строка на экране. Пустое состояние не сообщает о пустоте, а подсказывает первый шаг
 * (§8 ТЗ): «Начни с шалаша — Мира ночует под открытым небом».
 */
function openingLine(
  worldReady: boolean,
  buildings: number,
  villagers: readonly Villager[],
): string {
  if (!worldReady) return 'Остров поднимается из моря.';
  if (buildings > 0) return 'Здесь будет хорошо.';

  const first = villagers[0];
  if (first === undefined) return 'Начни с шалаша — ночевать пока негде.';
  return `Начни с шалаша — ${first.name.split(' ')[0] ?? first.name} ночует под открытым небом.`;
}
