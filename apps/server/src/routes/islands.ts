import { randomUUID } from 'node:crypto';

import { hourOfTick, toSnapshot, toVillagerSnapshot, type Command } from '@gavan/shared';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Database } from '../db/client';
import { islands, journal } from '../db/schema';
import { COMMANDS_PER_SECOND, type IslandRuntime } from '../island/runtime';
import {
  createIsland,
  insertIsland,
  makeSeed,
  makeVisitCode,
  type LiveIsland,
} from '../island/store';
import { verifySession } from './auth';

/**
 * Острова и команды (M5.3, M5.4).
 *
 * `POST /islands/:id/commands` — единственная точка, через которую мир меняется (§9 ТЗ).
 * Сервер проверяет всё сам тем же кодом, что и клиент, и ничего не берёт на веру из тела
 * запроса: подделанные координаты, цена или прогресс просто не участвуют в расчёте, потому
 * что сервер их не читает — он читает команду.
 */

/** Потолок на тело запроса: команда с 64 правками весит килобайты, не мегабайты. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Сколько команд принимаем за один запрос. Больше — это уже не игрок, а скрипт. */
const MAX_COMMANDS_PER_REQUEST = 64;

const vec3 = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() });
const rotation = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/**
 * Разбор команды. Схема повторяет форму `Command` из `shared` — но это не дубль логики,
 * а граница доверия: сюда приходит чужой JSON, и он обязан быть проверен до того, как
 * попадёт в чистое ядро.
 */
const commandSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('place_building'), typeId: z.string(), pos: vec3, rot: rotation }),
  z.object({ t: z.literal('move_building'), id: z.string(), pos: vec3, rot: rotation }),
  z.object({ t: z.literal('remove_building'), id: z.string() }),
  z.object({ t: z.literal('upgrade_building'), id: z.string() }),
  z.object({
    t: z.literal('assign_job'),
    villagerId: z.string(),
    buildingId: z.string().nullable(),
  }),
  z.object({ t: z.literal('assign_home'), villagerId: z.string(), buildingId: z.string() }),
  z.object({
    t: z.literal('terraform'),
    edits: z.array(z.object({ pos: vec3, mat: z.number().int().min(0).max(255) })),
  }),
  z.object({ t: z.literal('plant'), pos: vec3, kind: z.string() }),
  z.object({
    t: z.literal('rename'),
    scope: z.enum(['island', 'villager']),
    id: z.string().optional(),
    name: z.string().min(1).max(40),
  }),
  z.object({ t: z.literal('host_festival') }),
]);

type ParsedCommand = z.infer<typeof commandSchema>;

/**
 * Разобранное превращается в `Command`. Разница ровно в одном: у `rename` необязательное
 * поле, а строгие типы проекта не разрешают писать в него `undefined` явно.
 */
function toCommand(parsed: ParsedCommand): Command {
  if (parsed.t !== 'rename') return parsed;
  const { id, ...rest } = parsed;
  return id === undefined ? rest : { ...rest, id };
}

/** Простой счётчик частоты на пользователя. Хватает: соревнования нет, красть не у кого (§9 ТЗ). */
class RateLimiter {
  private readonly seen = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs = 1000): boolean {
    const now = Date.now();
    const recent = (this.seen.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      this.seen.set(key, recent);
      return false;
    }
    recent.push(now);
    this.seen.set(key, recent);
    return true;
  }
}

export function registerIslandRoutes(
  app: FastifyInstance,
  db: Database,
  runtime: IslandRuntime,
): void {
  const limiter = new RateLimiter();

  /** Достаёт остров, если он есть и принадлежит тому, кто спрашивает. */
  const ownedIsland = async (
    request: FastifyRequest,
    islandId: string,
  ): Promise<{ userId: string; island: LiveIsland } | { error: 401 | 403 | 404 }> => {
    const claims = await verifySession(request);
    if (claims === null) return { error: 401 };

    const rows = await db.select().from(islands).where(eq(islands.id, islandId)).limit(1);
    const row = rows[0];
    if (row === undefined) return { error: 404 };
    // Чужой остров не открывается по прямой ссылке. Гостевой режим — отдельным кодом на M8.
    if (row.ownerId !== claims.sub) return { error: 403 };

    const island = await runtime.open(islandId);
    if (island === null) return { error: 404 };

    return { userId: claims.sub, island };
  };

  app.post('/islands', async (request, reply) => {
    const claims = await verifySession(request);
    if (claims === null) return reply.code(401).send({ error: 'Нужно войти' });

    const parsed = z
      .object({ name: z.string().min(1).max(40).default('Гавань') })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'У острова должно быть имя' });

    const id = randomUUID();
    const island = createIsland(id, makeSeed());
    const visitCode = makeVisitCode();

    await insertIsland(db, claims.sub, parsed.data.name, island, visitCode);
    runtime.put(island);

    return reply.code(201).send({ id, name: parsed.data.name, seed: island.seed, visitCode });
  });

  app.get('/islands', async (request, reply) => {
    const claims = await verifySession(request);
    if (claims === null) return reply.code(401).send({ error: 'Нужно войти' });

    const rows = await db
      .select({ id: islands.id, name: islands.name, seed: islands.seed })
      .from(islands)
      .where(eq(islands.ownerId, claims.sub))
      .orderBy(desc(islands.createdAt));

    return reply.send({ islands: rows });
  });

  app.get('/islands/:id', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Такого острова нет' });

    const found = await ownedIsland(request, params.data.id);
    if ('error' in found) return reply.code(found.error).send({ error: explain(found.error) });

    const { island } = found;
    const row = (await db.select().from(islands).where(eq(islands.id, island.id)).limit(1))[0];

    return reply.send({
      id: island.id,
      seed: island.seed,
      /** Код для гостей. Показывается владельцу в порту и копируется одной кнопкой. */
      visitCode: row?.visitCode ?? '',
      chapter: island.chapter,
      /** Настройки острова: пока это только семьи, и по умолчанию они выключены (§5 ТЗ). */
      settings: island.settings,
      tick: island.tick,
      hour: hourOfTick(island.tick),
      world: toSnapshot(island.world),
      villagers: island.villagers.map(toVillagerSnapshot),
      storageCap: island.world.storageCap,
      // Что случилось, пока игрока не было (§3 ТЗ). Данные, а не готовый текст: слова
      // подбирает интерфейс, и он же решает, показывать ли экран возвращения вообще.
      catchUp: runtime.takeCatchUp(island),
    });
  });

  /**
   * Настройки острова (§5 ТЗ). Пока настройка ровно одна — семьи, и она выключена
   * по умолчанию: механика необязательная, и включать её должен человек, а не мы.
   */
  app.post('/islands/:id/settings', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Такого острова нет' });

    const found = await ownedIsland(request, params.data.id);
    if ('error' in found) return reply.code(found.error).send({ error: explain(found.error) });

    const body = z.object({ families: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Непонятная настройка' });

    found.island.settings = { families: body.data.families };
    found.island.dirty = true;

    return reply.send({ settings: found.island.settings });
  });

  app.post('/islands/:id/commands', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Такого острова нет' });

    const found = await ownedIsland(request, params.data.id);
    if ('error' in found) return reply.code(found.error).send({ error: explain(found.error) });

    const body = z
      .object({ commands: z.array(commandSchema).min(1).max(MAX_COMMANDS_PER_REQUEST) })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Не понимаю эту команду', outcomes: [] });
    }

    if (!limiter.allow(found.userId, COMMANDS_PER_SECOND)) {
      return reply.code(429).send({ error: 'Слишком часто. Переведи дух', outcomes: [] });
    }

    const outcomes = runtime.run(found.island, body.data.commands.map(toCommand));
    return reply.send({
      tick: found.island.tick,
      outcomes,
      resources: found.island.world.resources,
      storageCap: found.island.world.storageCap,
      buildings: found.island.world.buildings,
    });
  });

  app.get('/islands/:id/journal', async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Такого острова нет' });

    const found = await ownedIsland(request, params.data.id);
    if ('error' in found) return reply.code(found.error).send({ error: explain(found.error) });

    const query = z.object({ after: z.coerce.number().optional() }).safeParse(request.query);
    const after =
      query.success && query.data.after !== undefined ? new Date(query.data.after) : null;

    // Заготовка: дневник наполнится на M7, а ручка нужна клиенту уже сейчас.
    const entries = await db
      .select()
      .from(journal)
      .where(
        after === null
          ? eq(journal.islandId, params.data.id)
          : and(eq(journal.islandId, params.data.id), gt(journal.at, after)),
      )
      .orderBy(desc(journal.at))
      .limit(50);

    return reply.send({ entries });
  });
}

function explain(code: 401 | 403 | 404): string {
  if (code === 401) return 'Нужно войти';
  if (code === 403) return 'Это чужой остров. Хозяин может дать код для гостей';
  return 'Такого острова нет';
}
