import { config as loadEnvFiles } from 'dotenv';
import { z } from 'zod';

// Один .env на весь монорепозиторий: он лежит в корне, а сервер запускается из apps/server.
// Уже заданные переменные окружения приоритетнее файла — в бою .env-файла нет вообще.
loadEnvFiles({ path: ['.env', '../../.env'], quiet: true });

/** Секрет по умолчанию. Годится только для разработки и в бою запрещён явной проверкой. */
const DEV_SECRET = 'гавань-для-разработки-и-только-для-неё';

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
  /** Адрес самого сервера: он попадает в ссылку из письма, и она должна вести обратно сюда. */
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  /**
   * Чем подписывается сессия. В разработке значение по умолчанию удобно, в бою оно
   * запрещено: сервер не стартует, пока секрет не задан.
   */
  SESSION_SECRET: z.string().min(16).default(DEV_SECRET),
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

  if (result.data.NODE_ENV === 'production' && result.data.SESSION_SECRET === DEV_SECRET) {
    throw new Error(
      'Сервер не может стартовать: в бою нужен свой SESSION_SECRET.\n' +
        "Сгенерируй его: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }

  return result.data;
}
