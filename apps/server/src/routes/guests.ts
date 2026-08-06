import {
  giftKind,
  hourOfTick,
  postcard,
  toSnapshot,
  toVillagerSnapshot,
  GIFT_COOLDOWN_MS,
  type ResourceId,
} from '@gavan/shared';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Database } from '../db/client';
import { friends, gifts, islands, users, visits } from '../db/schema';
import { loadIsland } from '../island/store';
import type { IslandRuntime } from '../island/runtime';
import { verifySession } from './auth';

/**
 * Гости (§9 ТЗ).
 *
 * Социальная часть игры устроена так, чтобы не принести с собой ничего плохого: нет оценок,
 * нет счётчиков посещений, нет рейтингов, нет свободного текста — и, следовательно,
 * нет модерации.
 *
 * Гостевой снимок отдаётся **только на чтение**, и это выражено правами на сервере, а не
 * спрятанными кнопками на клиенте: ни одна команда от гостя не проходит проверку прав
 * в `/islands/:id/commands`, потому что там сверяется владелец.
 */
export function registerGuestRoutes(
  app: FastifyInstance,
  db: Database,
  runtime: IslandRuntime,
): void {
  /** Остров по короткому коду. Смотреть можно и без входа: анонимный просмотр разрешён. */
  app.get('/islands/by-code/:code', async (request, reply) => {
    const params = z.object({ code: z.string().min(4).max(12) }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Такого кода нет' });

    const rows = await db
      .select()
      .from(islands)
      .where(eq(islands.visitCode, params.data.code.toUpperCase()))
      .limit(1);

    const row = rows[0];
    if (row === undefined)
      return reply.code(404).send({ error: 'Остров по этому коду не нашёлся' });

    const island = (await runtime.open(row.id)) ?? (await loadIsland(db, row.id));
    if (island === null) return reply.code(404).send({ error: 'Остров по этому коду не нашёлся' });

    // След визита остаётся, но счётчик не показывается нигде и никогда (устав, п. 7).
    const claims = await verifySession(request);
    if (claims !== null && claims.sub !== row.ownerId) {
      await db.insert(visits).values({ islandId: row.id, guestUserId: claims.sub });
    }

    return reply.send({
      guest: true,
      id: island.id,
      name: row.name,
      seed: island.seed,
      tick: island.tick,
      hour: hourOfTick(island.tick),
      world: toSnapshot(island.world),
      villagers: island.villagers.map(toVillagerSnapshot),
      storageCap: island.world.storageCap,
      catchUp: null,
    });
  });

  /**
   * Подарок (§9 ТЗ): немного ресурсов **из склада гостя**.
   *
   * Отдающий действительно отдаёт. Иначе это было бы не «поделиться», а «начислить»,
   * и механика мгновенно превратилась бы в ферму.
   */
  app.post('/islands/:id/gifts', async (request, reply) => {
    const claims = await verifySession(request);
    if (claims === null) {
      return reply.code(401).send({ error: 'Чтобы оставить подарок, нужно войти' });
    }

    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const body = z
      .object({ kind: z.string().min(1).max(32), messageId: z.string().min(1).max(32) })
      .safeParse(request.body);

    if (!params.success) return reply.code(404).send({ error: 'Такого острова нет' });
    if (!body.success) return reply.code(400).send({ error: 'Выбери подарок и открытку' });

    // И подарок, и открытка — только из готового набора. Свободного текста нет нигде (§9 ТЗ).
    const gift = giftKind(body.data.kind);
    const card = postcard(body.data.messageId);
    if (gift === undefined || card === undefined) {
      return reply.code(400).send({ error: 'Такого подарка или открытки не бывает' });
    }

    const target = await db.select().from(islands).where(eq(islands.id, params.data.id)).limit(1);
    const row = target[0];
    if (row === undefined) return reply.code(404).send({ error: 'Такого острова нет' });
    if (row.ownerId === claims.sub) {
      return reply.code(400).send({ error: 'Себе дарить незачем — тут и так всё твоё' });
    }

    const recent = await db
      .select()
      .from(gifts)
      .where(
        and(
          eq(gifts.islandId, params.data.id),
          eq(gifts.fromUserId, claims.sub),
          gt(gifts.at, new Date(Date.now() - GIFT_COOLDOWN_MS)),
        ),
      )
      .limit(1);

    if (recent.length > 0) {
      return reply.code(429).send({ error: 'Подарок уже в пути. Загляни попозже' });
    }

    // Ресурсы уходят со склада дарителя — со всех его островов по очереди, начиная с первого.
    const mine = await db
      .select()
      .from(islands)
      .where(eq(islands.ownerId, claims.sub))
      .orderBy(desc(islands.createdAt))
      .limit(1);

    const from = mine[0];
    if (from === undefined) {
      return reply.code(400).send({ error: 'Сначала заведи свой остров' });
    }

    const giver = await runtime.open(from.id);
    if (giver === null) return reply.code(400).send({ error: 'Твой остров сейчас недоступен' });

    for (const [id, amount] of Object.entries(gift.gives) as [ResourceId, number][]) {
      if (giver.world.resources[id] < amount) {
        return reply
          .code(400)
          .send({ error: `На твоём складе для этого маловато. Выбери подарок попроще` });
      }
    }

    for (const [id, amount] of Object.entries(gift.gives) as [ResourceId, number][]) {
      giver.world.resources[id] -= amount;
    }
    giver.dirty = true;

    await db.insert(gifts).values({
      islandId: params.data.id,
      fromUserId: claims.sub,
      kind: gift.id,
      messageId: card.id,
    });

    // Подарок ждёт в порту сколько угодно: срока годности нет (§9 ТЗ).
    runtime.noteGift(params.data.id, claims.email);

    return reply.code(201).send({ ok: true });
  });

  /** Что лежит в порту. Владелец забирает, когда придёт. */
  app.get('/islands/:id/gifts', async (request, reply) => {
    const claims = await verifySession(request);
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (claims === null || !params.success) return reply.code(401).send({ error: 'Нужно войти' });

    const rows = await db
      .select({
        id: gifts.id,
        kind: gifts.kind,
        messageId: gifts.messageId,
        at: gifts.at,
        from: users.email,
      })
      .from(gifts)
      .innerJoin(islands, eq(gifts.islandId, islands.id))
      .innerJoin(users, eq(gifts.fromUserId, users.id))
      .where(and(eq(gifts.islandId, params.data.id), eq(gifts.claimed, false)))
      .orderBy(desc(gifts.at));

    const owned = await db
      .select({ ownerId: islands.ownerId })
      .from(islands)
      .where(eq(islands.id, params.data.id))
      .limit(1);
    if (owned[0]?.ownerId !== claims.sub) return reply.code(403).send({ error: 'Чужой остров' });

    return reply.send({ gifts: rows });
  });

  /** Забрать подарок: ресурсы ложатся на склад, открытка остаётся в дневнике. */
  app.post('/islands/:id/gifts/:giftId/claim', async (request, reply) => {
    const claims = await verifySession(request);
    const params = z.object({ id: z.uuid(), giftId: z.uuid() }).safeParse(request.params);
    if (claims === null || !params.success) return reply.code(401).send({ error: 'Нужно войти' });

    const owned = await db
      .select({ ownerId: islands.ownerId })
      .from(islands)
      .where(eq(islands.id, params.data.id))
      .limit(1);
    if (owned[0]?.ownerId !== claims.sub) return reply.code(403).send({ error: 'Чужой остров' });

    const rows = await db
      .select()
      .from(gifts)
      .where(and(eq(gifts.id, params.data.giftId), eq(gifts.claimed, false)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) return reply.code(404).send({ error: 'Этот подарок уже забрали' });

    const gift = giftKind(row.kind);
    const island = await runtime.open(params.data.id);
    if (gift === undefined || island === null) {
      return reply.code(404).send({ error: 'Этот подарок уже забрали' });
    }

    for (const [id, amount] of Object.entries(gift.gives) as [ResourceId, number][]) {
      island.world.resources[id] = Math.min(
        island.world.storageCap,
        island.world.resources[id] + amount,
      );
    }
    island.dirty = true;

    await db.update(gifts).set({ claimed: true }).where(eq(gifts.id, row.id));
    return reply.send({ ok: true, resources: island.world.resources });
  });

  /**
   * Друзья: взаимное добавление и быстрый переход. Ничего сравнительного — ни оценок,
   * ни списка «лучшие острова» (устав, п. 7).
   */
  app.post('/friends/:code', async (request, reply) => {
    const claims = await verifySession(request);
    const params = z.object({ code: z.string().min(4).max(12) }).safeParse(request.params);
    if (claims === null || !params.success) return reply.code(401).send({ error: 'Нужно войти' });

    const rows = await db
      .select({ ownerId: islands.ownerId })
      .from(islands)
      .where(eq(islands.visitCode, params.data.code.toUpperCase()))
      .limit(1);

    const ownerId = rows[0]?.ownerId;
    if (ownerId === undefined) return reply.code(404).send({ error: 'Остров не нашёлся' });
    if (ownerId === claims.sub) return reply.send({ ok: true });

    await db
      .insert(friends)
      .values({ userId: claims.sub, friendUserId: ownerId })
      .onConflictDoNothing();

    return reply.send({ ok: true });
  });

  app.get('/friends', async (request, reply) => {
    const claims = await verifySession(request);
    if (claims === null) return reply.code(401).send({ error: 'Нужно войти' });

    const rows = await db
      .select({ code: islands.visitCode, name: islands.name })
      .from(friends)
      .innerJoin(islands, eq(friends.friendUserId, islands.ownerId))
      .where(eq(friends.userId, claims.sub));

    return reply.send({ friends: rows });
  });
}
