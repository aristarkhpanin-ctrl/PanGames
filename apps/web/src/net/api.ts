import type {
  CatchUpEvent,
  Command,
  IslandSettings,
  ValidationResult,
  Villager,
  WorldSnapshot,
} from '@gavan/shared';

import { serverUrl } from './health';

/**
 * Разговор с сервером (M5.3, M5.4).
 *
 * Cookie сессии ходит сама — она httpOnly, и клиентский код её не видит и не должен.
 * Ответы приходят из сети, поэтому разбираются осторожно: чужой JSON не приводится
 * к типу на веру.
 */

export interface Me {
  id: string;
  email: string;
}

export interface IslandBrief {
  id: string;
  name: string;
  seed: number;
}

/** Меняет настройку острова. Возвращает то, что решил сервер, а не то, что мы просили. */
export async function setFamilies(id: string, families: boolean): Promise<IslandSettings | null> {
  try {
    const response = await fetch(`${serverUrl}/islands/${id}/settings`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ families }),
    });
    if (!response.ok) return null;
    // Приведение, а не проверка: форма ответа наша собственная и описана рядом.
    return ((await response.json()) as { settings: IslandSettings }).settings;
  } catch {
    return null;
  }
}

export interface IslandState {
  id: string;
  /** Гостевой снимок: read-only. Строить и копать тут нельзя ничего. */
  guest?: boolean;
  name?: string;
  visitCode?: string;
  chapter?: number;
  /** Настройки острова. Пока одна — семьи, по умолчанию выключены (§5 ТЗ). */
  settings?: IslandSettings;
  seed: number;
  tick: number;
  hour: number;
  world: WorldSnapshot;
  villagers: Villager[];
  storageCap: number;
  /** Что случилось, пока игрока не было. `null` — не было и нечего показывать. */
  catchUp: CatchUpEvent[] | null;
}

export interface CommandsResponse {
  tick: number;
  outcomes: { index: number; result: ValidationResult }[];
  resources: Record<string, number>;
  storageCap: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(`${serverUrl}${path}`, {
      credentials: 'include',
      headers: init?.body === undefined ? {} : { 'content-type': 'application/json' },
      ...init,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Сеть отвалилась — это не повод падать. Игра переживает разрыв связи спокойно.
    return null;
  }
}

export function fetchMe(): Promise<Me | null> {
  return call<Me>('/me');
}

export async function requestMagicLink(email: string): Promise<boolean> {
  const response = await call<{ ok: boolean }>('/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return response !== null;
}

export async function fetchIslands(): Promise<IslandBrief[]> {
  const response = await call<{ islands: IslandBrief[] }>('/islands');
  return response?.islands ?? [];
}

export function createIsland(name: string): Promise<IslandBrief | null> {
  return call<IslandBrief>('/islands', { method: 'POST', body: JSON.stringify({ name }) });
}

export function fetchIsland(id: string): Promise<IslandState | null> {
  return call<IslandState>(`/islands/${id}`);
}

export function sendCommands(
  id: string,
  commands: readonly Command[],
): Promise<CommandsResponse | null> {
  return call<CommandsResponse>(`/islands/${id}/commands`, {
    method: 'POST',
    body: JSON.stringify({ commands }),
  });
}

export interface JournalEntry {
  kind: string;
  text: string;
  actors: string[];
  at: string;
}

export async function fetchJournal(id: string): Promise<JournalEntry[]> {
  const response = await call<{ entries: JournalEntry[] }>(`/islands/${id}/journal`);
  return response?.entries ?? [];
}

export function fetchIslandByCode(code: string): Promise<IslandState | null> {
  return call<IslandState>(`/islands/by-code/${code}`);
}

export interface WaitingGift {
  id: string;
  kind: string;
  messageId: string | null;
  from: string;
}

export async function fetchGifts(id: string): Promise<WaitingGift[]> {
  const response = await call<{ gifts: WaitingGift[] }>(`/islands/${id}/gifts`);
  return response?.gifts ?? [];
}

/**
 * Подарок уходит со склада гостя, поэтому отказ здесь — обычное дело: может не хватить.
 * Ответ разбирается целиком, а не проверяется на «не упало»: иначе интерфейс радостно
 * сообщит об успехе там, где сервер отказал.
 */
export async function sendGift(
  id: string,
  kind: string,
  messageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${serverUrl}/islands/${id}/gifts`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, messageId }),
    });

    if (response.ok) return { ok: true };

    const body = (await response.json()) as { error?: string };
    return { ok: false, error: body.error ?? 'Не получилось. Попробуй ещё раз' };
  } catch {
    return { ok: false, error: 'Сервер не отвечает. Подарок подождёт' };
  }
}

export function claimGift(
  islandId: string,
  giftId: string,
): Promise<{ resources: Record<string, number> } | null> {
  return call<{ resources: Record<string, number> }>(`/islands/${islandId}/gifts/${giftId}/claim`, {
    method: 'POST',
  });
}

export function addFriend(code: string): Promise<unknown> {
  return call(`/friends/${code}`, { method: 'POST' });
}

export function logout(): Promise<unknown> {
  return call('/auth/logout', { method: 'POST' });
}
