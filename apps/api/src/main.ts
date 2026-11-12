import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { Application } from 'express';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig, ConfigError } from './common/config';
import type { AppConfig } from './common/config';
import { loadEnvFiles } from './common/load-env';
import { runMigrations } from './db/migrate';
import { buildOpenApiDocument } from './openapi';

async function bootstrap(): Promise<void> {
  loadEnvFiles();
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
  configureApp(app);
  app.enableCors({ origin: config.publicBaseUrl });
  app.enableShutdownHooks();

  const document = buildOpenApiDocument(app);
  const server = app.getHttpAdapter().getInstance() as Application;
  server.get('/openapi.json', (_req, res) => {
    res.json(document);
  });

  await app.listen(config.port);
  const logger = app.get(Logger);
  logger.log(`StatusBeam API listening on http://localhost:${config.port}`);
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal boot error:', error instanceof Error ? error.stack : error);
  process.exit(1);
});
