import { count, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import type { Database } from '../db/client';
import { buildings, islands, users, visits } from '../db/schema';

/**
 * Аналитика (§11 ТЗ) — **только агрегаты, без слежки**.
 *
 * Здесь нет и не будет: событий отдельного игрока, воронок, идентификаторов устройств,
 * внешних трекеров, рекламных пикселей. Ни одна строка ответа не относится к конкретному
 * человеку — только «сколько» и «в среднем».
 *
 * Три числа, ради которых это вообще существует (§12 ТЗ, «что смотреть после запуска»):
 * доходят ли игроки до второй главы, возвращаются ли, ходят ли друг к другу. Если не доходят —
 * чинить надо игру, а не показатели.
 */

/** Что отдаётся наружу. Список закрытый: добавить сюда почту физически некуда. */
export interface Stats {
  islands: number;
  players: number;
  /** Сколько островов дошло до каждой главы. Ключ — номер главы, значение — сколько их. */
  chapters: Record<string, number>;
  /** Островов, где кто-то был за последние сутки. Не «кто», а «сколько». */
  activeToday: number;
  visits: number;
  averageBuildings: number;
}

export function registerStatsRoutes(app: FastifyInstance, db: Database): void {
  app.get('/stats', async (_request, reply) => {
    const [islandRow] = await db.select({ value: count() }).from(islands);
    const [playerRow] = await db.select({ value: count() }).from(users);
    const [visitRow] = await db.select({ value: count() }).from(visits);

    const chapterRows = await db
      .select({ chapter: islands.chapter, value: count() })
      .from(islands)
      .groupBy(islands.chapter);

    const [activeRow] = await db
      .select({ value: count() })
      .from(islands)
      .where(sql`${islands.lastTickAt} > now() - interval '1 day'`);

    const chapters: Record<string, number> = {};
    for (const row of chapterRows) chapters[String(row.chapter)] = row.value;

    const [buildingRow] = await db.select({ value: count() }).from(buildings);

    const stats: Stats = {
      islands: islandRow?.value ?? 0,
      players: playerRow?.value ?? 0,
      chapters,
      activeToday: activeRow?.value ?? 0,
      visits: visitRow?.value ?? 0,
      averageBuildings:
        (islandRow?.value ?? 0) === 0
          ? 0
          : Math.round(((buildingRow?.value ?? 0) / (islandRow?.value ?? 1)) * 10) / 10,
    };

    return reply.send(stats);
  });
}
