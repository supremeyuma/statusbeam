import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';

/**
 * HTTP setup shared by main.ts and e2e tests so tests exercise the same middleware,
 * validation, and cookie behaviour as production.
 */
export function configureApp(app: INestApplication): void {
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
