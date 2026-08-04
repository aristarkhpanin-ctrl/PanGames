import type { Command, ValidationResult, Villager, WorldSnapshot } from '@gavan/shared';

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

export interface IslandState {
  id: string;
  seed: number;
  tick: number;
  hour: number;
  world: WorldSnapshot;
  villagers: Villager[];
  storageCap: number;
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

export function logout(): Promise<unknown> {
  return call('/auth/logout', { method: 'POST' });
}
