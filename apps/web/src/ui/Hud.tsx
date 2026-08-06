import { materialColor, PLANTS, type Villager } from '@gavan/shared';
import { useEffect } from 'react';

import { FILL_MATERIALS } from '../input/editing';
import { BuildBar } from './BuildBar';
import { BuildingCard } from './BuildingCard';
import { ResourceBar } from './ResourceBar';
import { GiftsWaiting, GuestBar, VisitCode } from './Guests';
import { Journal } from './Journal';
import { MuteButton, ScaleButton } from './Settings';
import { SignIn } from './SignIn';
import { Welcome } from './Welcome';
import { ChapterTitle } from './ChapterTitle';
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
  const watching = useGameStore((state) => state.watching);
  const journalOpen = useGameStore((state) => state.journalOpen);
  const guest = useGameStore((state) => state.guest);
  const arrival = useGameStore((state) => state.arrival);
  const moored = useGameStore((state) => state.moored);
  const touch = useGameStore((state) => state.touch);
  const toggleJournal = useGameStore((state) => state.toggleJournal);
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

  const opening = openingLine(worldReady, buildings.length, villagers, arrival);
  const selected = villagers.find((villager) => villager.id === selectedId);
  const plant = PLANTS[plantIndex % PLANTS.length];
  const fillName = FILL_LABEL[fillIndex % FILL_LABEL.length] ?? 'землю';
  const fillColor = FILL_MATERIALS[fillIndex % FILL_MATERIALS.length];

  if (session === undefined) return <></>;
  if (session === null) return <SignIn />;

  // Режим «Смотреть»: интерфейс не сворачивается, а уходит целиком (§8 ТЗ).
  // Название главы остаётся: оно и есть то, ради чего смотрят.
  if (watching) return <ChapterTitle />;

  // Прибытие (§11 ТЗ): на экране море, лодка и ровно одна строка. Ни панелей, ни кнопок,
  // ни «пропустить» — пропускается любой клавишей и любым щелчком, и говорить об этом не надо.
  if (arrival === 'playing') {
    return moored ? <p className="arrival-line">Здесь будет хорошо</p> : <></>;
  }

  return (
    <>
      <div className="hud-corner">
        <h1 className="hud-title">Гавань</h1>
        {opening !== '' && <p className="hud-note">{opening}</p>}
        {worldReady && !guest && <ResourceBar />}
        {worldReady && <VisitCode />}
      </div>

      <div className="hud-top">
        <MuteButton />
        <ScaleButton />
        <button type="button" className="journal-button" onClick={toggleJournal}>
          {journalOpen ? 'закрыть дневник' : 'дневник'}
        </button>
      </div>

      <VillagerColumn villagers={villagers} />
      {selected !== undefined && <VillagerCard villager={selected} />}
      <BuildingCard />
      <BuildBar />
      <Journal />
      <GiftsWaiting />
      <GuestBar />
      <Welcome />
      <ChapterTitle />

      {!guest && touch && <TouchTools />}

      {!guest && !touch && (
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
            {' · V смотреть · Ctrl+Z отменить'}
          </span>
        </div>
      )}

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
 * Инструменты для пальца (§8 ТЗ, мобильное управление).
 *
 * На телефоне клавиш 1–5 нет, а значит, без этого ряда до строительства и лопаты
 * не добраться вовсе. Кнопки крупные и подписаны словом: значок без подписи пришлось бы
 * угадывать, а игра не про угадывание.
 */
function TouchTools(): React.JSX.Element {
  const mode = useGameStore((state) => state.mode);
  const setMode = useGameStore((state) => state.setMode);
  const brush = useGameStore((state) => state.brush);
  const toggleBrush = useGameStore((state) => state.toggleBrush);
  const fillIndex = useGameStore((state) => state.fillIndex);
  const cycleFill = useGameStore((state) => state.cycleFill);
  const plantIndex = useGameStore((state) => state.plantIndex);
  const cyclePlant = useGameStore((state) => state.cyclePlant);

  const plant = PLANTS[plantIndex % PLANTS.length];
  const fillName = FILL_LABEL[fillIndex % FILL_LABEL.length] ?? 'землю';

  return (
    <div className="touch-tools">
      {(mode === 'fill' || mode === 'plant' || mode === 'dig') && (
        <div className="touch-row touch-row-quiet">
          {mode === 'fill' && (
            <button
              type="button"
              className="touch-tool"
              onClick={() => {
                cycleFill(FILL_MATERIALS.length);
              }}
            >
              {fillName}
            </button>
          )}
          {mode === 'plant' && plant !== undefined && (
            <button
              type="button"
              className="touch-tool"
              onClick={() => {
                cyclePlant(PLANTS.length);
              }}
            >
              {plant.name.toLowerCase()}
            </button>
          )}
          {(mode === 'dig' || mode === 'fill') && (
            <button type="button" className="touch-tool" onClick={toggleBrush}>
              {brush === 0 ? 'одна клетка' : 'три на три'}
            </button>
          )}
        </div>
      )}

      <div className="touch-row">
        {(Object.keys(MODE_LABEL) as EditMode[]).map((id) => (
          <button
            key={id}
            type="button"
            className={id === mode ? 'touch-tool touch-tool-on' : 'touch-tool'}
            onClick={() => {
              setMode(id);
            }}
            aria-pressed={id === mode}
          >
            {TOUCH_LABEL[id]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Подписи кнопок: не «Копаю», а «копать» — на кнопке пишут действие, а не состояние. */
const TOUCH_LABEL: Record<EditMode, string> = {
  look: 'смотреть',
  dig: 'копать',
  fill: 'насыпать',
  plant: 'сажать',
  build: 'строить',
};

/**
 * Первая строка на экране. Пустое состояние не сообщает о пустоте, а подсказывает первый шаг
 * (§8 ТЗ): «Начни с шалаша — Мира ночует под открытым небом».
 *
 * Кто только что смотрел прибытие, этой подсказки не получает: в первой минуте должна быть
 * ровно одна строка (§11 ТЗ), и она уже была. Что делать дальше, там говорит подсвеченное
 * место на песке, а не текст.
 */
function openingLine(
  worldReady: boolean,
  buildings: number,
  villagers: readonly Villager[],
  arrival: 'none' | 'playing' | 'shown',
): string {
  if (!worldReady) return 'Остров поднимается из моря.';
  if (buildings > 0) return 'Здесь будет хорошо.';
  if (arrival === 'shown') return '';

  const first = villagers[0];
  if (first === undefined) return 'Начни с шалаша — ночевать пока негде.';
  return `Начни с шалаша — ${first.name.split(' ')[0] ?? first.name} ночует под открытым небом.`;
}
