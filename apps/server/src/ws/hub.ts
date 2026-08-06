import { hourOfTick, toSnapshot, toVillagerSnapshot } from '@gavan/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Database } from '../db/client';
import { islands } from '../db/schema';
import type { IslandRuntime, TickBroadcast } from '../island/runtime';
import { verifySession } from '../routes/auth';

/**
 * Связь с клиентом (M5.5).
 *
 * Сервер шлёт `tick` — состояние жителей, склад и здания раз в десять секунд; между тиками
 * клиент двигает людей сам (§9 ТЗ). Позиции каждый кадр по сети не ходят и ходить не должны:
 * это тысячекратный трафик ради того, что клиент прекрасно считает интерполяцией.
 *
 * Клиент шлёт только `command`. Всё остальное решает сервер.
 */

interface Client {
  islandId: string;
  send: (data: string) => void;
}

export async function registerWebSocket(
  app: FastifyInstance,
  db: Database,
  runtime: IslandRuntime,
): Promise<void> {
  const clients = new Set<Client>();

  runtime.onTick((broadcast) => {
    const message = JSON.stringify(tickMessage(broadcast));
    for (const client of clients) {
      if (client.islandId === broadcast.islandId) client.send(message);
    }
  });

  await app.register((scope, _options, done) => {
    scope.get('/ws', { websocket: true }, (socket, request) => {
      void (async () => {
        const query = z.object({ islandId: z.uuid() }).safeParse(request.query);
        if (!query.success) {
          socket.close(4000, 'нужен islandId');
          return;
        }

        // Та же cookie, что и у REST: отдельного способа войти по вебсокету нет.
        const claims = await verifySession(request);
        if (claims === null) {
          socket.close(4001, 'нужно войти');
          return;
        }

        const rows = await db
          .select({ ownerId: islands.ownerId })
          .from(islands)
          .where(eq(islands.id, query.data.islandId))
          .limit(1);

        if (rows[0]?.ownerId !== claims.sub) {
          socket.close(4003, 'это чужой остров');
          return;
        }

        const island = await runtime.open(query.data.islandId);
        if (island === null) {
          socket.close(4004, 'острова нет');
          return;
        }

        const client: Client = {
          islandId: query.data.islandId,
          send: (data) => {
            socket.send(data);
          },
        };
        clients.add(client);
        runtime.join(client.islandId);

        // Первое сообщение — полное состояние: переподключившийся клиент догоняет разом,
        // а не собирает мир по дельтам.
        socket.send(
          JSON.stringify({
            type: 'hello',
            islandId: island.id,
            seed: island.seed,
            tick: island.tick,
            hour: hourOfTick(island.tick),
            world: toSnapshot(island.world),
            villagers: island.villagers.map(toVillagerSnapshot),
            storageCap: island.world.storageCap,
            catchUp: runtime.takeCatchUp(island),
          }),
        );

        socket.on('close', () => {
          clients.delete(client);
          runtime.leave(client.islandId);
        });

        socket.on('error', () => {
          clients.delete(client);
          runtime.leave(client.islandId);
        });
      })();
    });

    done();
  });
}

function tickMessage(broadcast: TickBroadcast): unknown {
  return {
    type: 'tick',
    tick: broadcast.tick,
    hour: broadcast.hour,
    villagers: broadcast.villagers.map(toVillagerSnapshot),
    resources: broadcast.resources,
    storageCap: broadcast.storageCap,
    buildings: broadcast.buildings,
    journal: broadcast.journal,
    ...(broadcast.chapter === undefined ? {} : { chapter: broadcast.chapter }),
  };
}
