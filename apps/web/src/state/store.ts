import type { CatchUpEvent, Command, PlacedBuilding, ResourceId, Villager } from '@gavan/shared';
import { BASE_STORAGE_CAP, startingResources } from '@gavan/shared';
import { create } from 'zustand';

/**
 * Единственный стор клиента: состояние интерфейса и зеркало игрового состояния.
 * React читает отсюда и ничего не знает про сцену; сцена пишет сюда и ничего не знает про React.
 */

export type ServerStatus = 'unknown' | 'online' | 'unreachable';

export interface Session {
  id: string;
  email: string;
}

export interface IslandInfo {
  id: string;
  name: string;
}

/** Что делает левая кнопка мыши. */
export type EditMode = 'look' | 'dig' | 'fill' | 'plant' | 'build';

interface GameState {
  serverStatus: ServerStatus;
  setServerStatus: (status: ServerStatus) => void;

  /**
   * Кто вошёл. `undefined` — ещё выясняем, `null` — не вошёл никто.
   * Разница важна: пока выясняем, показывать приглашение войти рано.
   */
  session: Session | null | undefined;
  setSession: (session: Session | null) => void;

  island: IslandInfo | null;
  setIsland: (island: IslandInfo | null) => void;

  /**
   * Гостевой режим: остров чужой и только на просмотр. Панели строительства и лопаты
   * не блокируются, а отсутствуют — read-only означает read-only (§9 ТЗ).
   */
  guest: boolean;
  setGuest: (guest: boolean) => void;

  /** Код острова для гостей. Показывается владельцу и копируется одной кнопкой. */
  visitCode: string | null;
  setVisitCode: (code: string | null) => void;

  /** Остров сгенерирован и все чанки отрисованы. */
  worldReady: boolean;
  setWorldReady: (ready: boolean) => void;

  mode: EditMode;
  setMode: (mode: EditMode) => void;

  /** 0 — одна клетка, 1 — площадка три на три. */
  brush: 0 | 1;
  toggleBrush: () => void;

  fillIndex: number;
  cycleFill: (count: number) => void;

  plantIndex: number;
  cyclePlant: (count: number) => void;

  /** Что сейчас строим. Пусто — панель открыта, но здание не выбрано. */
  buildTypeId: string | null;
  chooseBuilding: (typeId: string | null) => void;

  buildRotation: 0 | 1 | 2 | 3;
  rotateBuild: () => void;

  /** Здание, которое переносим. Перемещение бесплатно и всегда (устав, п. 6). */
  movingBuildingId: string | null;
  startMoving: (id: string | null) => void;

  /** Зеркало склада и построек. Источник правды — мир, сюда сцена кладёт снимок. */
  resources: Record<ResourceId, number>;
  storageCap: number;
  buildings: readonly PlacedBuilding[];
  setEconomy: (
    resources: Record<ResourceId, number>,
    storageCap: number,
    buildings: readonly PlacedBuilding[],
  ) => void;

  /** Текущий тик хозяйства. Нужен, чтобы честно назвать возврат при разборке. */
  tick: number;
  setTick: (tick: number) => void;

  /**
   * Как интерфейс отправляет команды. Ставит сцена при запуске: React не знает про шину,
   * а шина не знает про React, и связывает их одна эта функция.
   */
  send: ((command: Command) => void) | null;
  setSender: (send: ((command: Command) => void) | null) => void;

  /**
   * Поставить здание туда, где сейчас призрак. На телефоне это кнопка, а не щелчок:
   * палец закрывает место установки, и «ткнуть точно» им нельзя.
   */
  confirmBuild: (() => void) | null;
  setConfirmBuild: (confirm: (() => void) | null) => void;

  /** Развёрнут ли полный список ресурсов. По умолчанию видны четыре (§8 ТЗ). */
  resourcesOpen: boolean;
  toggleResources: () => void;

  selectedBuilding: string | null;
  selectBuilding: (id: string | null) => void;

  /**
   * Что случилось, пока игрока не было. `null` — показывать нечего или уже показали:
   * экран возвращения не всплывает дважды и ничему не мешает.
   */
  catchUp: readonly CatchUpEvent[] | null;
  setCatchUp: (events: readonly CatchUpEvent[] | null) => void;
  dismissCatchUp: () => void;

  /** Дневник острова — signature-элемент игры (§8 ТЗ). */
  journalOpen: boolean;
  toggleJournal: () => void;
  /** Записи, приехавшие с тиками этой сессии. Ложатся поверх сохранённой ленты. */
  journal: readonly { kind: string; text: string; actors: string[] }[];
  addJournal: (entries: readonly { kind: string; text: string; actors: string[] }[]) => void;

  /** Название новой главы. Показывается крупно, тихо и один раз (§7 ТЗ). */
  chapterName: string | null;
  showChapter: (name: string | null) => void;

  /** Режим «Смотреть»: интерфейс исчезает целиком (§8 ТЗ). */
  watching: boolean;
  setWatching: (watching: boolean) => void;

  /**
   * Прибытие (§11 ТЗ). `none` — не показывали, `playing` — идёт прямо сейчас,
   * `shown` — показали в этой сессии. Пока идёт, на экране нет ничего, кроме одной строки.
   */
  arrival: 'none' | 'playing' | 'shown';
  setArrival: (arrival: 'none' | 'playing' | 'shown') => void;

  /** Лодка причалила: только с этого момента появляется та самая единственная строка. */
  moored: boolean;
  setMoored: (moored: boolean) => void;

  /**
   * Игрок трогает экран пальцем. Определяется по первому касанию, а не по ширине окна:
   * узкое окно на ноутбуке — это не телефон, а телефон, повёрнутый боком, — не десктоп.
   */
  touch: boolean;
  setTouch: (touch: boolean) => void;

  /** Зеркало жителей из воркера симуляции. React читает отсюда, сцена сюда пишет. */
  villagers: readonly Villager[];
  setVillagers: (villagers: readonly Villager[]) => void;

  selectedVillager: string | null;
  selectVillager: (id: string | null) => void;

  /**
   * Кого игрок снял с работы вручную. Автоназначение таких не трогает: решение игрока
   * всегда сильнее подсказки.
   */
  detachedWorkers: readonly string[];
  setDetached: (id: string, detached: boolean) => void;

  /** Тихая строка внизу экрана: подсказка или объяснение отказа. Не алерт. */
  notice: string | null;
  noticeAt: number;
  setNotice: (text: string | null) => void;

  /**
   * Масштаб интерфейса: 100, 125 или 150% (§8 ТЗ). Хранится рядом с браузером — это
   * свойство глаз, а не острова, и переезжать с острова на остров ему незачем.
   */
  uiScale: number;
  cycleUiScale: () => void;

  /**
   * Esc закрывает верхнее открытое окно, а не всё сразу. Возвращает `true`, если было
   * что закрывать: тогда клавиша считается использованной и режим не сбрасывается.
   */
  closeTop: () => boolean;
}

/** Доступные масштабы интерфейса. Ниже 100% не бывает: мельче — это не доступность. */
export const UI_SCALES: readonly number[] = [1, 1.25, 1.5];

const UI_SCALE_KEY = 'gavan.uiScale';

function savedScale(): number {
  try {
    const stored = Number(window.localStorage.getItem(UI_SCALE_KEY));
    return UI_SCALES.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

function applyScale(scale: number): void {
  try {
    window.localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    // Приватный режим: масштаб просто не переживёт перезагрузку.
  }
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

export const useGameStore = create<GameState>()((set) => ({
  serverStatus: 'unknown',
  setServerStatus: (serverStatus) => {
    set({ serverStatus });
  },

  session: undefined,
  setSession: (session) => {
    set({ session });
  },

  island: null,
  setIsland: (island) => {
    set({ island });
  },

  guest: false,
  setGuest: (guest) => {
    set({ guest, mode: 'look' });
  },

  visitCode: null,
  setVisitCode: (visitCode) => {
    set({ visitCode });
  },

  worldReady: false,
  setWorldReady: (worldReady) => {
    set({ worldReady });
  },

  mode: 'look',
  setMode: (mode) => {
    set({ mode, notice: null, movingBuildingId: null });
  },

  brush: 0,
  toggleBrush: () => {
    set((state) => ({ brush: state.brush === 0 ? 1 : 0 }));
  },

  fillIndex: 0,
  cycleFill: (count) => {
    set((state) => ({ fillIndex: (state.fillIndex + 1) % count }));
  },

  plantIndex: 0,
  cyclePlant: (count) => {
    set((state) => ({ plantIndex: (state.plantIndex + 1) % count }));
  },

  buildTypeId: null,
  chooseBuilding: (buildTypeId) => {
    set({ buildTypeId, mode: 'build', movingBuildingId: null, notice: null });
  },

  buildRotation: 0,
  rotateBuild: () => {
    set((state) => ({ buildRotation: ((state.buildRotation + 1) % 4) as 0 | 1 | 2 | 3 }));
  },

  movingBuildingId: null,
  startMoving: (movingBuildingId) => {
    set({ movingBuildingId, mode: movingBuildingId === null ? 'look' : 'build' });
  },

  resources: startingResources(),
  storageCap: BASE_STORAGE_CAP,
  buildings: [],
  setEconomy: (resources, storageCap, buildings) => {
    set({ resources, storageCap, buildings });
  },

  tick: 0,
  setTick: (tick) => {
    set({ tick });
  },

  send: null,
  setSender: (send) => {
    set({ send });
  },

  confirmBuild: null,
  setConfirmBuild: (confirmBuild) => {
    set({ confirmBuild });
  },

  resourcesOpen: false,
  toggleResources: () => {
    set((state) => ({ resourcesOpen: !state.resourcesOpen }));
  },

  selectedBuilding: null,
  selectBuilding: (selectedBuilding) => {
    set({ selectedBuilding, selectedVillager: null });
  },

  catchUp: null,
  setCatchUp: (catchUp) => {
    set({ catchUp });
  },
  dismissCatchUp: () => {
    set({ catchUp: null });
  },

  journalOpen: false,
  toggleJournal: () => {
    set((state) => ({ journalOpen: !state.journalOpen }));
  },
  journal: [],
  addJournal: (entries) => {
    if (entries.length === 0) return;
    // Новое сверху: лента читается от свежего к старому.
    set((state) => ({ journal: [...entries, ...state.journal].slice(0, 200) }));
  },

  chapterName: null,
  showChapter: (chapterName) => {
    set({ chapterName });
  },

  watching: false,
  setWatching: (watching) => {
    set({ watching, journalOpen: false, selectedBuilding: null, selectedVillager: null });
  },

  arrival: 'none',
  setArrival: (arrival) => {
    set({ arrival });
  },

  moored: false,
  setMoored: (moored) => {
    set({ moored });
  },

  touch: false,
  setTouch: (touch) => {
    if (useGameStore.getState().touch === touch) return;
    set({ touch });
  },

  villagers: [],
  setVillagers: (villagers) => {
    set({ villagers });
  },

  selectedVillager: null,
  selectVillager: (selectedVillager) => {
    set({ selectedVillager });
  },

  detachedWorkers: [],
  setDetached: (id, detached) => {
    set((state) => ({
      detachedWorkers: detached
        ? [...new Set([...state.detachedWorkers, id])]
        : state.detachedWorkers.filter((other) => other !== id),
    }));
  },

  notice: null,
  noticeAt: 0,
  setNotice: (notice) => {
    set({ notice, noticeAt: Date.now() });
  },

  uiScale: savedScale(),
  cycleUiScale: () => {
    set((state) => {
      const next = UI_SCALES[(UI_SCALES.indexOf(state.uiScale) + 1) % UI_SCALES.length] ?? 1;
      applyScale(next);
      return { uiScale: next };
    });
  },

  closeTop: () => {
    // Порядок обратный тому, в каком окна ложатся друг на друга: сверху вниз.
    const state = useGameStore.getState();

    if (state.catchUp !== null) {
      set({ catchUp: null });
      return true;
    }
    if (state.journalOpen) {
      set({ journalOpen: false });
      return true;
    }
    if (state.selectedVillager !== null) {
      set({ selectedVillager: null });
      return true;
    }
    if (state.selectedBuilding !== null) {
      set({ selectedBuilding: null });
      return true;
    }
    return false;
  },
}));

// Масштаб применяется сразу при запуске: иначе первый кадр показывался бы в чужом размере.
applyScale(useGameStore.getState().uiScale);
