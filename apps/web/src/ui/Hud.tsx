import { materialColor, PLANTS } from '@gavan/shared';
import { useEffect } from 'react';

import { FILL_MATERIALS } from '../input/editing';
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

  return (
    <>
      <div className="hud-corner">
        <h1 className="hud-title">Гавань</h1>
        <p className="hud-note">
          {worldReady ? 'Здесь будет хорошо.' : 'Остров поднимается из моря.'}
        </p>
      </div>

      <VillagerColumn villagers={villagers} />
      {selected !== undefined && <VillagerCard villager={selected} />}

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

        {mode !== 'look' && mode !== 'plant' && (
          <span className="hud-choice">{brush === 0 ? 'одна клетка' : 'три на три'}</span>
        )}

        <span className="hud-hint">
          1 смотреть · 2 копать · 3 насыпать · 4 сажать
          {mode === 'fill' && ' · X материал · B кисть'}
          {mode === 'plant' && ' · C растение'}
          {mode === 'dig' && ' · B кисть'}
          {' · Ctrl+Z отменить'}
        </span>
      </div>

      {notice !== null && <p className="hud-notice">{notice}</p>}
    </>
  );
}
