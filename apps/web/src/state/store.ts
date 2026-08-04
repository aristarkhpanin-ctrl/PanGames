import type { Command, PlacedBuilding, ResourceId, Villager } from '@gavan/shared';
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

  /** Развёрнут ли полный список ресурсов. По умолчанию видны четыре (§8 ТЗ). */
  resourcesOpen: boolean;
  toggleResources: () => void;

  selectedBuilding: string | null;
  selectBuilding: (id: string | null) => void;

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

  resourcesOpen: false,
  toggleResources: () => {
    set((state) => ({ resourcesOpen: !state.resourcesOpen }));
  },

  selectedBuilding: null,
  selectBuilding: (selectedBuilding) => {
    set({ selectedBuilding, selectedVillager: null });
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
}));
