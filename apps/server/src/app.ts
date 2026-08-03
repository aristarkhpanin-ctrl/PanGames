import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Config } from './config';

export async function createApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : true,
  });

  // Клиент и сервер живут на разных доменах и в бою (§1 ТЗ), поэтому CORS нужен всегда,
  // а credentials — потому что JWT приезжает в httpOnly cookie (M5.2).
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  });

  app.get('/health', () => ({ ok: true }));

  return app;
}
