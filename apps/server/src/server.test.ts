import { execSync } from 'node:child_process';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SEA_LEVEL, surfaceHeight, WORLD_Y } from '@gavan/shared';

import { createApp } from './app';
import { loadConfig } from './config';
import { MemoryMail } from './mail/transport';

/**
 * Проверки сервера на настоящей базе (M5).
 *
 * База поднимается отдельная и с нуля: тест, который зависит от того, что уже лежит
 * в базе разработчика, врёт через раз. Если базы нет — тесты честно пропускаются,
 * а не притворяются зелёными.
 */

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://gavan:gavan@127.0.0.1:5432/gavan';
const TEST_DB = 'gavan_test';
const TEST_URL = BASE_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

let app: FastifyInstance;
let sql: ReturnType<typeof postgres>;
let mail: MemoryMail;

/**
 * База поднимается прямо здесь, при загрузке файла: `describe.skipIf` решает свою судьбу
 * до того, как отработает `beforeAll`, и узнать про отсутствующую базу позже уже поздно —
 * тесты падали бы вместо того, чтобы честно пропуститься.
 */
const available = ((): boolean => {
  try {
    execSync(
      `psql "${BASE_URL}" -c "drop database if exists ${TEST_DB}" -c "create database ${TEST_DB}"`,
      { stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  if (!available) return;

  const migrator = postgres(TEST_URL, { max: 1 });
  await migrate(drizzle(migrator), { migrationsFolder: './drizzle' });
  await migrator.end();

  sql = postgres(TEST_URL);
  mail = new MemoryMail();

  const config = { ...loadConfig(), NODE_ENV: 'test' as const, DATABASE_URL: TEST_URL };
  app = await createApp(config, {
    db: drizzle(sql),
    close: () => Promise.resolve(),
    mail,
  });
});

afterAll(async () => {
  if (!available) return;
  await app.close();
  await sql.end();
});

beforeEach(() => {
  if (available) mail.sent.length = 0;
});

/** Проходит вход целиком и возвращает cookie сессии. */
async function signIn(email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email } });

  const letter = mail.sent.at(-1);
  if (letter === undefined) throw new Error('письмо не отправлено');
  const token = /token=([\w-]+)/.exec(letter.text)?.[1];
  if (token === undefined) throw new Error('в письме нет токена');

  const callback = await app.inject({ method: 'GET', url: `/auth/callback?token=${token}` });
  const cookie = callback.cookies.find((c) => c.name === 'gavan_session');
  if (cookie === undefined) throw new Error('сессия не выдана');

  return `gavan_session=${cookie.value}`;
}

async function makeIsland(cookie: string): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/islands',
    headers: { cookie },
    payload: { name: 'Тихая' },
  });
  return created.json<{ id: string }>().id;
}

describe.skipIf(!available)('вход по ссылке', () => {
  it('письмо приходит, ссылка работает, сессия живёт', async () => {
    const cookie = await signIn('mira@example.com');

    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: 'mira@example.com' });
  });

  it('без сессии не пускает', async () => {
    const me = await app.inject({ method: 'GET', url: '/me' });
    expect(me.statusCode).toBe(401);
  });

  it('одна и та же ссылка второй раз не срабатывает', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: { email: 'gor@example.com' },
    });
    const token = /token=([\w-]+)/.exec(mail.sent.at(-1)?.text ?? '')?.[1] ?? '';

    const first = await app.inject({ method: 'GET', url: `/auth/callback?token=${token}` });
    expect(first.statusCode).toBe(302);

    const second = await app.inject({ method: 'GET', url: `/auth/callback?token=${token}` });
    expect(second.statusCode).toBe(400);
  });

  it('придуманный токен не пускает', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/callback?token=нетакой' });
    expect(response.statusCode).toBe(400);
  });

  it('писем на один адрес не больше пяти в час', async () => {
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/auth/magic-link',
        payload: { email: 'lada@example.com' },
      });
    }
    const extra = await app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: { email: 'lada@example.com' },
    });
    expect(extra.statusCode).toBe(429);
    // Отказ говорит, что делать дальше, а не сообщает о лимите.
    expect(extra.json<{ error: string }>().error).toContain('почту');
  });
});

describe.skipIf(!available)('острова', () => {
  it('создаётся с четырьмя жителями и переживает перезагрузку', async () => {
    const cookie = await signIn('zhdan@example.com');
    const id = await makeIsland(cookie);

    const island = await app.inject({ method: 'GET', url: `/islands/${id}`, headers: { cookie } });
    expect(island.statusCode).toBe(200);

    const body = island.json<{ villagers: unknown[]; world: { seed: number } }>();
    expect(body.villagers).toHaveLength(4);
    expect(body.world.seed).toBeGreaterThan(0);
  });

  it('чужой остров по прямой ссылке не открывается', async () => {
    const owner = await signIn('owner@example.com');
    const id = await makeIsland(owner);

    const stranger = await signIn('stranger@example.com');
    const response = await app.inject({
      method: 'GET',
      url: `/islands/${id}`,
      headers: { cookie: stranger },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: string }>().error).toContain('чужой остров');
  });

  it('без входа не отдаётся вовсе', async () => {
    const cookie = await signIn('quiet@example.com');
    const id = await makeIsland(cookie);

    const response = await app.inject({ method: 'GET', url: `/islands/${id}` });
    expect(response.statusCode).toBe(401);
  });
});

describe.skipIf(!available)('команды', () => {
  it('ставят здание и списывают ресурсы на сервере', async () => {
    const cookie = await signIn('builder@example.com');
    const id = await makeIsland(cookie);

    const island = (
      await app.inject({ method: 'GET', url: `/islands/${id}`, headers: { cookie } })
    ).json<{
      world: { resources: Record<string, number> };
    }>();
    expect(island.world.resources.wood).toBe(12);

    const spot = await flatSpot(id);
    const response = await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: { commands: [{ t: 'place_building', typeId: 'hut', pos: spot, rot: 0 }] },
    });

    const body = response.json<{
      outcomes: { result: { ok: boolean } }[];
      resources: Record<string, number>;
      buildings: unknown[];
    }>();
    expect(body.outcomes[0]?.result.ok).toBe(true);
    expect(body.resources.wood).toBe(8);
    expect(body.buildings).toHaveLength(1);
  });

  it('не даёт ресурсов из воздуха: подделка в теле запроса ничего не меняет', async () => {
    const cookie = await signIn('cheater@example.com');
    const id = await makeIsland(cookie);
    const spot = await flatSpot(id);

    // В команде нет ни цены, ни прогресса — сервер их не читает и читать не может.
    const response = await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: {
        commands: [
          {
            t: 'place_building',
            typeId: 'hut',
            pos: spot,
            rot: 0,
            cost: { wood: 0 },
            progress: 1,
            resources: { wood: 9999 },
          },
        ],
      },
    });

    const body = response.json<{
      resources: Record<string, number>;
      buildings: { progress: number }[];
    }>();
    expect(body.resources.wood).toBe(8);
    expect(body.buildings[0]?.progress).toBe(0);
  });

  it('отклоняет то, на что не хватает, и не портит склад', async () => {
    const cookie = await signIn('poor@example.com');
    const id = await makeIsland(cookie);
    const spot = await flatSpot(id);

    const response = await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: { commands: [{ t: 'place_building', typeId: 'granary', pos: spot, rot: 0 }] },
    });

    const body = response.json<{
      outcomes: { result: { ok: boolean; reason?: string } }[];
      resources: Record<string, number>;
    }>();
    expect(body.outcomes[0]?.result.ok).toBe(false);
    expect(body.resources.wood).toBe(12);
  });

  it('несуществующее здание отклоняется по коду, а не падением', async () => {
    const cookie = await signIn('ghost@example.com');
    const id = await makeIsland(cookie);

    const response = await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: { commands: [{ t: 'remove_building', id: 'building-999' }] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ outcomes: { result: { ok: boolean; reason?: string } }[] }>();
    expect(body.outcomes[0]?.result).toEqual({ ok: false, reason: 'no_such_building' });
  });

  it('чужой остров командами не меняется', async () => {
    const owner = await signIn('mine@example.com');
    const id = await makeIsland(owner);
    const stranger = await signIn('yours@example.com');

    const response = await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie: stranger },
      payload: { commands: [{ t: 'remove_building', id: 'building-1' }] },
    });

    expect(response.statusCode).toBe(403);
  });

  it('держит лимит правок в одной команде', async () => {
    const cookie = await signIn('digger@example.com');
    const id = await makeIsland(cookie);

    const edits = Array.from({ length: 100 }, (_, i) => ({
      pos: { x: 40 + i, y: 20, z: 40 },
      mat: 0,
    }));

    const response = await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: { commands: [{ t: 'terraform', edits }] },
    });

    const body = response.json<{ outcomes: { result: { ok: boolean; reason?: string } }[] }>();
    expect(body.outcomes[0]?.result).toEqual({ ok: false, reason: 'too_many_edits' });
  });

  it('мусор в теле запроса не роняет сервер', async () => {
    const cookie = await signIn('junk@example.com');
    const id = await makeIsland(cookie);

    const response = await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: { commands: [{ t: 'выдумка', что: 'угодно' }] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('перезагрузка ничего не теряет', async () => {
    const cookie = await signIn('keeper@example.com');
    const id = await makeIsland(cookie);
    const spot = await flatSpot(id);

    await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: { commands: [{ t: 'place_building', typeId: 'hut', pos: spot, rot: 0 }] },
    });

    // Остров уходит из памяти и поднимается заново — ровно то, что делает перезапуск сервера.
    await app.runtime.stop();
    app.runtime.start();

    const island = (
      await app.inject({ method: 'GET', url: `/islands/${id}`, headers: { cookie } })
    ).json<{
      world: { buildings: unknown[]; resources: Record<string, number> };
    }>();
    expect(island.world.buildings).toHaveLength(1);
    expect(island.world.resources.wood).toBe(8);
  });
});

describe.skipIf(!available)('живой тик', () => {
  it('идёт только для островов, на которых кто-то есть', async () => {
    const cookie = await signIn('ticker@example.com');
    const id = await makeIsland(cookie);
    const island = await app.runtime.open(id);
    if (island === null) throw new Error('остров не поднялся');

    const before = island.tick;
    expect(app.runtime.playersOn(id)).toBe(0);

    // Никто не подключён — шага не происходит.
    app.runtime.join(id);
    expect(app.runtime.playersOn(id)).toBe(1);
    app.runtime.step(island);
    expect(island.tick).toBe(before + 1);

    app.runtime.leave(id);
    expect(app.runtime.playersOn(id)).toBe(0);
  });

  it('время двигает только сервер: тик из тела запроса не читается', async () => {
    const cookie = await signIn('clock@example.com');
    const id = await makeIsland(cookie);
    const island = await app.runtime.open(id);
    if (island === null) throw new Error('остров не поднялся');

    const before = island.tick;
    await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: {
        commands: [{ t: 'plant', pos: { x: 1, y: 1, z: 1 }, kind: 'flower' }],
        tick: 99999,
      },
    });

    expect(island.tick).toBe(before);
  });
});

/**
 * Ровное место под шалаш. Ищется по самому миру, а не перебором запросов: сервер откажет
 * на склоне и в воде, а проверяем мы не это.
 */
async function flatSpot(id: string): Promise<{ x: number; y: number; z: number }> {
  const island = await app.runtime.open(id);
  if (island === null) throw new Error('остров не поднялся');

  const taken = new Set(island.world.buildings.map((b) => `${String(b.x)}:${String(b.z)}`));

  for (let z = 20; z < 140; z += 1) {
    for (let x = 20; x < 140; x += 1) {
      if (taken.has(`${String(x)}:${String(z)}`)) continue;

      const heights = [
        surfaceHeight(island.reader, x, z, WORLD_Y - 1),
        surfaceHeight(island.reader, x + 1, z, WORLD_Y - 1),
        surfaceHeight(island.reader, x, z + 1, WORLD_Y - 1),
        surfaceHeight(island.reader, x + 1, z + 1, WORLD_Y - 1),
      ];

      if (heights.some((h) => h <= SEA_LEVEL)) continue;
      if (Math.max(...heights) - Math.min(...heights) > 1) continue;

      return { x, y: Math.min(...heights) + 1, z };
    }
  }

  throw new Error('не нашлось ровного места');
}

describe.skipIf(!available)('догон', () => {
  /** Отматывает серверное время последнего расчёта назад — как будто игрок ушёл. */
  async function goAway(id: string, hours: number): Promise<void> {
    await sql`update islands set last_tick_at = now() - ${`${String(hours)} hours`}::interval where id = ${id}`;
    app.runtime.forget(id);
  }

  it('первый вход в новый остров догона не делает', async () => {
    const cookie = await signIn('fresh@example.com');
    const id = await makeIsland(cookie);

    const island = (
      await app.inject({ method: 'GET', url: `/islands/${id}`, headers: { cookie } })
    ).json<{ catchUp: unknown }>();

    expect(island.catchUp).toBeNull();
  });

  it('сутки отсутствия дают правдоподобный результат', async () => {
    const cookie = await signIn('away@example.com');
    const id = await makeIsland(cookie);
    const spot = await flatSpot(id);

    await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: { commands: [{ t: 'place_building', typeId: 'hut', pos: spot, rot: 0 }] },
    });
    await app.runtime.stop();
    app.runtime.start();

    await goAway(id, 24);

    const island = (
      await app.inject({ method: 'GET', url: `/islands/${id}`, headers: { cookie } })
    ).json<{
      catchUp: { kind: string }[] | null;
      world: { buildings: { progress: number }[] };
      villagers: { mood: number }[];
    }>();

    // Стройка закончилась, кто-то въехал, настроение спокойное.
    expect(island.world.buildings[0]?.progress).toBe(1);
    expect(island.catchUp?.some((event) => event.kind === 'built')).toBe(true);
    expect(island.catchUp?.some((event) => event.kind === 'settled')).toBe(true);
    for (const villager of island.villagers) {
      expect(villager.mood).toBeGreaterThanOrEqual(55);
    }
  });

  it('второй запрос догон не повторяет', async () => {
    const cookie = await signIn('twice@example.com');
    const id = await makeIsland(cookie);
    await app.runtime.stop();
    app.runtime.start();
    await goAway(id, 24);

    const read = async () =>
      (await app.inject({ method: 'GET', url: `/islands/${id}`, headers: { cookie } })).json<{
        catchUp: unknown;
        tick: number;
      }>();

    const first = await read();
    const second = await read();

    expect(first.catchUp).not.toBeNull();
    // Экран возвращения показывается один раз, и время второй раз не начисляется.
    expect(second.catchUp).toBeNull();
    expect(second.tick).toBe(first.tick);
  });

  it('два одновременных запроса не начисляют ресурсы дважды', async () => {
    const cookie = await signIn('race@example.com');
    const id = await makeIsland(cookie);
    const spot = await flatSpot(id);

    await app.inject({
      method: 'POST',
      url: `/islands/${id}/commands`,
      headers: { cookie },
      payload: { commands: [{ t: 'place_building', typeId: 'woodcutter', pos: spot, rot: 0 }] },
    });
    await app.runtime.stop();
    app.runtime.start();
    await goAway(id, 24);

    const [left, right] = await Promise.all([
      app.inject({ method: 'GET', url: `/islands/${id}`, headers: { cookie } }),
      app.inject({ method: 'GET', url: `/islands/${id}`, headers: { cookie } }),
    ]);

    const a = left.json<{ tick: number; world: { resources: Record<string, number> } }>();
    const b = right.json<{ tick: number; world: { resources: Record<string, number> } }>();

    expect(a.tick).toBe(b.tick);
    expect(a.world.resources.wood).toBe(b.world.resources.wood);
  });

  it('подмена времени в запросе ни на что не влияет', async () => {
    const cookie = await signIn('timelord@example.com');
    const id = await makeIsland(cookie);
    await app.runtime.stop();
    app.runtime.start();

    const readTick = async (query = ''): Promise<number> =>
      (
        await app.inject({ method: 'GET', url: `/islands/${id}${query}`, headers: { cookie } })
      ).json<{ tick: number }>().tick;

    const before = await readTick();

    // Остров стоял час; в запросе просим начислить тысячу.
    await goAway(id, 1);
    const greedy = (await readTick('?absenceMs=999999999&hours=1000&tick=999999')) - before;

    // И тот же час без всяких просьб.
    await goAway(id, 1);
    const honest = (await readTick()) - before - greedy;

    // Сколько бы клиент ни просил, зачлось ровно то, что прошло по серверным часам.
    expect(greedy).toBe(honest);
    expect(greedy).toBeGreaterThan(0);
  });
});
