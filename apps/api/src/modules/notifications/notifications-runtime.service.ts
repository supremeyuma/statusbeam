import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { UnrecoverableError, Worker } from 'bullmq';
import Redis from 'ioredis';
import type { Job, Queue } from 'bullmq';

import { APP_CONFIG } from '../../common/config.module';
import type { AppConfig } from '../../common/config';
import { NotificationProcessor } from './notification.processor';
import { MetricsService } from '../../common/metrics.service';
import {
  NOTIFICATIONS_QUEUE,
  NOTIFICATIONS_QUEUE_NAME,
  NOTIFICATION_DLQ,
} from './notifications.tokens';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsRuntimeService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsRuntimeService.name);
  private worker: Worker | null = null;

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(NOTIFICATIONS_QUEUE) private readonly queue: Queue | null,
    @Inject(NOTIFICATION_DLQ) private readonly dlq: Queue | null,
    private readonly processor: NotificationProcessor,
    private readonly notifications: NotificationsService,
    private readonly metrics: MetricsService,
  ) {}

  public onModuleInit(): void {
    if (!this.config.jobsEnabled || !this.queue) {
      return;
    }

    this.worker = new Worker(
      NOTIFICATIONS_QUEUE_NAME,
      async (job) => {
        const data = job.data as { updateId?: unknown; channelId?: unknown };
        if (typeof data.updateId !== 'string' || typeof data.channelId !== 'string') {
          throw new UnrecoverableError('notification job is missing updateId or channelId');
        }

        const result = await this.processor.deliver(data.updateId, data.channelId);
        if (result.ok) {
          return result;
        }

        if (!result.retryable) {
          throw new UnrecoverableError(`${result.errorClass}: ${result.message}`);
        }

        const error = new Error(`${result.errorClass}: ${result.message}`);
        (error as Error & { errorClass?: string }).errorClass = result.errorClass;
        throw error;
      },
      {
        connection: new Redis(this.config.redisUrl, { maxRetriesPerRequest: null }),
        concurrency: 5,
      },
    );

    this.worker.on('failed', (job, error) => {
      if (!job) {
        return;
      }
      void this.handleFailure(job, error);
    });
    this.worker.on('error', (error) => {
      this.logger.error(`notification worker error: ${error.message}`);
    });

    this.logger.log('notification worker started');
  }

  private async handleFailure(job: Job, error: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    const permanent = error instanceof UnrecoverableError || error.name === 'UnrecoverableError';
    if (!permanent && job.attemptsMade < attempts) {
      return;
    }

    const data = job.data as { updateId?: unknown; channelId?: unknown };
    if (typeof data.updateId !== 'string' || typeof data.channelId !== 'string') {
      return;
    }

    const errorClass =
      (error as Error & { errorClass?: string }).errorClass ??
      /^([a-z0-9_]+):/i.exec(error.message)?.[1] ??
      'unknown';

    try {
      await this.notifications.recordFailure({
        jobId: job.id ?? `unknown:${Date.now()}`,
        channelId: data.channelId,
        incidentUpdateId: data.updateId,
        errorClass,
        message: error.message,
        attempts: job.attemptsMade,
      });
      this.metrics.notificationDlq.inc();
      await job.remove();
    } catch (failureError) {
      this.logger.error(
        `failed to move notification ${job.id} to the DLQ: ${
          failureError instanceof Error ? failureError.message : String(failureError)
        }`,
      );
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
    }
    if (this.dlq) {
      await this.dlq.close();
    }
  }
}
