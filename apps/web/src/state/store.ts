import { create } from 'zustand';

/**
 * Единственный стор клиента: состояние интерфейса и зеркало игрового состояния.
 * React читает отсюда и ничего не знает про сцену; сцена пишет сюда и ничего не знает про React.
 */

export type ServerStatus = 'unknown' | 'online' | 'unreachable';

interface GameState {
  serverStatus: ServerStatus;
  setServerStatus: (status: ServerStatus) => void;
}

export const useGameStore = create<GameState>()((set) => ({
  serverStatus: 'unknown',
  setServerStatus: (serverStatus) => {
    set({ serverStatus });
  },
}));
