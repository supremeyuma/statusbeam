import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

import { APP_CONFIG } from '../common/config.module';
import type { AppConfig } from '../common/config';
import { CheckProcessor } from './check.processor';
import {
  CHECKS_QUEUE,
  CHECKS_QUEUE_NAME,
  MAINTENANCE_QUEUE,
  MAINTENANCE_QUEUE_NAME,
} from './jobs.tokens';
import { RetentionService } from './retention.service';
import { RollupService } from './rollup.service';

@Injectable()
export class JobsRuntimeService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JobsRuntimeService.name);
  private readonly workers: Worker[] = [];

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CHECKS_QUEUE) private readonly checksQueue: Queue | null,
    @Inject(MAINTENANCE_QUEUE) private readonly maintenanceQueue: Queue | null,
    private readonly checkProcessor: CheckProcessor,
    private readonly rollup: RollupService,
    private readonly retention: RetentionService,
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!this.config.jobsEnabled || !this.maintenanceQueue || !this.checksQueue) {
      return;
    }

    const checkWorker = new Worker(
      CHECKS_QUEUE_NAME,
      async (job) => {
        const monitorId = (job.data as { monitorId?: unknown }).monitorId;
        if (typeof monitorId !== 'string') {
          throw new Error(`check job ${job.id} is missing a monitorId`);
        }
        await this.checkProcessor.process(monitorId, job.timestamp);
      },
      {
        connection: new Redis(this.config.redisUrl, { maxRetriesPerRequest: null }),
        concurrency: 5,
      },
    );

    const maintenanceWorker = new Worker(
      MAINTENANCE_QUEUE_NAME,
      async (job) => {
        if (job.name === 'rollup') {
          const previousHour = new Date(Date.now() - 60 * 60 * 1000);
          await this.rollup.rollupHour(previousHour);
          return;
        }
        if (job.name === 'retention') {
          await this.retention.run();
        }
      },
      {
        connection: new Redis(this.config.redisUrl, { maxRetriesPerRequest: null }),
        concurrency: 1,
      },
    );

    for (const worker of [checkWorker, maintenanceWorker]) {
      worker.on('failed', (job, error) => {
        this.logger.error(`job ${job?.id ?? 'unknown'} failed: ${error.message}`);
      });
      this.workers.push(worker);
    }

    await this.maintenanceQueue.upsertJobScheduler(
      'rollup:hourly',
      { pattern: '5 * * * *' },
      { name: 'rollup' },
    );
    await this.maintenanceQueue.upsertJobScheduler(
      'retention:daily',
      { pattern: '30 3 * * *' },
      { name: 'retention' },
    );

    this.logger.log('check and maintenance workers started');
  }

  public async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    this.workers.length = 0;
    if (this.checksQueue) {
      await this.checksQueue.close();
    }
    if (this.maintenanceQueue) {
      await this.maintenanceQueue.close();
    }
  }
}
