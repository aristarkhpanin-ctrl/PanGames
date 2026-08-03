import { config as loadEnvFiles } from 'dotenv';
import { z } from 'zod';

// Один .env на весь монорепозиторий: он лежит в корне, а сервер запускается из apps/server.
// Уже заданные переменные окружения приоритетнее файла — в бою .env-файла нет вообще.
loadEnvFiles({ path: ['.env', '../../.env'], quiet: true });

/**
 * Сервер не стартует с кривым конфигом: лучше упасть на запуске с понятным текстом,
 * чем отвечать 500 на первый же запрос игрока.
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL: z.url({ error: 'Нужна строка подключения к Postgres, см. .env.example' }),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Сервер не может стартовать — проблемы в переменных окружения:\n${problems}\n` +
        'Скопируй образец в корне проекта: cp .env.example .env',
    );
  }

  return result.data;
}
