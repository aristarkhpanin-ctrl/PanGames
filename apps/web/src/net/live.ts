import type { PlacedBuilding, Villager, WorldSnapshot } from '@gavan/shared';

import { serverUrl } from './health';

/**
 * Живая связь с островом (M5.5).
 *
 * Сервер шлёт состояние раз в десять секунд, клиент между тиками двигает жителей сам.
 * Разрыв связи не ломает игру: остров остаётся на экране, соединение восстанавливается
 * само, а при возврате приезжает полное состояние — догонять по кусочкам не нужно.
 */

export interface HelloMessage {
  type: 'hello';
  islandId: string;
  seed: number;
  tick: number;
  hour: number;
  world: WorldSnapshot;
  villagers: Villager[];
  storageCap: number;
}

export interface TickMessage {
  type: 'tick';
  tick: number;
  hour: number;
  villagers: Villager[];
  resources: Record<string, number>;
  storageCap: number;
  buildings: PlacedBuilding[];
  /** Новые записи дневника за этот тик. Обычно пусто. */
  journal?: { kind: string; text: string; actors: string[] }[];
  /** Новая глава, если она наступила прямо сейчас. */
  chapter?: { number: number; name: string };
}

export type LiveMessage = HelloMessage | TickMessage;

export type LinkStatus = 'connecting' | 'online' | 'offline';

export interface LiveHandlers {
  onMessage: (message: LiveMessage) => void;
  onStatus: (status: LinkStatus) => void;
}

/** Сколько ждать до следующей попытки. Растёт, но не превращается в вечность. */
const RETRY_STEPS_MS = [1000, 2000, 4000, 8000, 15000];

export class LiveLink {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly islandId: string,
    private readonly handlers: LiveHandlers,
  ) {}

  connect(): void {
    if (this.closed) return;

    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'offline');

    const base = serverUrl.replace(/^http/, 'ws');
    const socket = new WebSocket(`${base}/ws?islandId=${this.islandId}`);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus('online');
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      const message = parse(event.data);
      if (message !== null) this.handlers.onMessage(message);
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.closed) return;
      this.handlers.onStatus('offline');
      this.scheduleRetry();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);

    const wait = RETRY_STEPS_MS[Math.min(this.attempt, RETRY_STEPS_MS.length - 1)] ?? 15000;
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.connect();
    }, wait);
  }

  dispose(): void {
    this.closed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
  }
}

/** Сообщение приходит из сети, поэтому проверяется, а не приводится к типу на веру. */
function parse(raw: string): LiveMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('type' in value)) return null;
    if (value.type !== 'hello' && value.type !== 'tick') return null;
    return value as LiveMessage;
  } catch {
    return null;
  }
}
