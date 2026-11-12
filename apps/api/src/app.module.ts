import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { ConfigModule, APP_CONFIG } from './common/config.module';
import type { AppConfig } from './common/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpMetricsMiddleware } from './common/http-metrics.middleware';
import { buildPinoOptions } from './common/logger';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { DatabaseModule } from './db/database.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { MonitorsModule } from './modules/monitors/monitors.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildPinoOptions(config),
    }),
    DatabaseModule,
    RedisModule,
    MetricsModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    ApiKeysModule,
    MonitorsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, HttpMetricsMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
