import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { loadConfig, ConfigError } from './common/config';
import type { AppConfig } from './common/config';
import { runMigrations } from './db/migrate';

async function bootstrap(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  if (config.nodeEnv === 'development') {
    await runMigrations(config.databaseUrl);
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  await app.listen(config.port);
  const logger = app.get(Logger);
  logger.log(`StatusBeam API listening on http://localhost:${config.port}`);
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal boot error:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
