import 'reflect-metadata';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';

// Documentation generation must work in CI without production secrets.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgres://statusbeam:statusbeam@localhost:5433/statusbeam';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.JWT_SECRET ??= 'openapi-generation-secret-with-32-chars';
process.env.JWT_REFRESH_SECRET ??= 'openapi-generation-refresh-with-32-chars';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.LOG_LEVEL ??= 'silent';

async function main(): Promise<void> {
  const { AppModule } = await import('../src/app.module');
  const { buildOpenApiDocument } = await import('../src/openapi');

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const document = buildOpenApiDocument(app);

  const output = resolve(__dirname, '../../../packages/contracts/openapi.json');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  await app.close();
  console.log(`OpenAPI written to ${output}`);
}

main().catch((error: unknown) => {
  console.error('OpenAPI generation failed:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
