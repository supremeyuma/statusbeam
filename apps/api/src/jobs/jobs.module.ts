import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { APP_CONFIG } from '../common/config.module';
import type { AppConfig } from '../common/config';
import { CheckProcessor } from './check.processor';
import { CheckerService } from '../modules/checks/checker.service';
import { LockService } from '../modules/checks/lock.service';
import { IncidentsModule } from '../modules/incidents/incidents.module';
import { JobsRuntimeService } from './jobs-runtime.service';
import {
  CHECKS_QUEUE,
  CHECKS_QUEUE_NAME,
  MAINTENANCE_QUEUE,
  MAINTENANCE_QUEUE_NAME,
} from './jobs.tokens';
import { RetentionService } from './retention.service';
import { RollupService } from './rollup.service';
import { SchedulerService } from './scheduler.service';

export function createQueue(name: string, redisUrl: string): Queue {
  return new Queue(name, {
    connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
  });
}

@Global()
@Module({
  imports: [IncidentsModule],
  providers: [
    {
      provide: CHECKS_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.jobsEnabled ? createQueue(CHECKS_QUEUE_NAME, config.redisUrl) : null,
    },
    {
      provide: MAINTENANCE_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.jobsEnabled ? createQueue(MAINTENANCE_QUEUE_NAME, config.redisUrl) : null,
    },
    CheckerService,
    LockService,
    CheckProcessor,
    SchedulerService,
    RollupService,
    RetentionService,
    JobsRuntimeService,
  ],
  exports: [
    CHECKS_QUEUE,
    MAINTENANCE_QUEUE,
    CheckerService,
    CheckProcessor,
    SchedulerService,
    RollupService,
    RetentionService,
  ],
})
export class JobsModule {}
