import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await createApp(config);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`Получен ${signal}, останавливаюсь`);
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
