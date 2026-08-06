import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Config } from './config';
import { createDb, type Database } from './db/client';
import { IslandRuntime } from './island/runtime';
import { ConsoleMail, type MailTransport } from './mail/transport';
import { registerAuthRoutes, SESSION_COOKIE } from './routes/auth';
import { registerGuestRoutes } from './routes/guests';
import { MAX_BODY_BYTES, registerIslandRoutes } from './routes/islands';
import { registerWebSocket } from './ws/hub';

/** Чем подменяют внешний мир тесты: своя база и своя почта. */
export interface AppParts {
  db: Database;
  close: () => Promise<void>;
  mail?: MailTransport;
}

export async function createApp(config: Config, parts?: AppParts): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : config.NODE_ENV !== 'test',
    // Команда с 64 правками весит килобайты; всё, что больше, — не игрок.
    bodyLimit: MAX_BODY_BYTES,
  });

  const database = parts ?? openDatabase(config);
  const mail = parts?.mail ?? new ConsoleMail(app.log);

  // Клиент и сервер живут на разных доменах и в бою (§1 ТЗ), поэтому CORS нужен всегда,
  // а credentials — потому что сессия приезжает в httpOnly cookie.
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.SESSION_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });
  await app.register(websocket);

  const runtime = new IslandRuntime(database.db);
  runtime.start();

  app.get('/health', () => ({ ok: true }));
  registerAuthRoutes(app, database.db, config, mail);
  registerIslandRoutes(app, database.db, runtime);
  registerGuestRoutes(app, database.db, runtime);
  await registerWebSocket(app, database.db, runtime);

  app.addHook('onClose', async () => {
    await runtime.stop();
    await database.close();
  });

  app.decorate('runtime', runtime);
  return app;
}

function openDatabase(config: Config): AppParts {
  const { sql, db } = createDb(config.DATABASE_URL);
  return { db, close: () => sql.end() };
}

declare module 'fastify' {
  interface FastifyInstance {
    runtime: IslandRuntime;
  }
}
