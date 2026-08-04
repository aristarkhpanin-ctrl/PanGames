import { create } from 'zustand';

/**
 * Единственный стор клиента: состояние интерфейса и зеркало игрового состояния.
 * React читает отсюда и ничего не знает про сцену; сцена пишет сюда и ничего не знает про React.
 */

export type ServerStatus = 'unknown' | 'online' | 'unreachable';

/** Что делает левая кнопка мыши. */
export type EditMode = 'look' | 'dig' | 'fill' | 'plant';

interface GameState {
  serverStatus: ServerStatus;
  setServerStatus: (status: ServerStatus) => void;

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

  worldReady: false,
  setWorldReady: (worldReady) => {
    set({ worldReady });
  },

  mode: 'look',
  setMode: (mode) => {
    set({ mode, notice: null });
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

  notice: null,
  noticeAt: 0,
  setNotice: (notice) => {
    set({ notice, noticeAt: Date.now() });
  },
}));
