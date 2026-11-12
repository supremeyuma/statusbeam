import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { APP_CONFIG } from '../common/config.module';
import type { AppConfig } from '../common/config';
import { CHECKS_QUEUE } from './jobs.tokens';

@Injectable()
export class SchedulerService {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CHECKS_QUEUE) private readonly queue: Queue | null,
  ) {}

  /**
   * One repeatable BullMQ job per monitor. `jobId` is stable so deploy churn does not create
   * duplicate schedules; the worker still takes a Redis lock before running.
   */
  public async sync(monitor: { id: string; intervalS: number; active: boolean }): Promise<void> {
    if (!this.config.jobsEnabled || !this.queue) {
      return;
    }

    if (!monitor.active) {
      await this.remove(monitor.id);
      return;
    }

    await this.queue.upsertJobScheduler(
      `monitor:${monitor.id}`,
      { every: monitor.intervalS * 1000 },
      {
        name: 'check',
        data: { monitorId: monitor.id },
        opts: { removeOnComplete: 100, removeOnFail: 500 },
      },
    );
  }

  public async remove(monitorId: string): Promise<void> {
    if (!this.queue) {
      return;
    }
    await this.queue.removeJobScheduler(`monitor:${monitorId}`);
  }

  public async listSchedulerIds(): Promise<string[]> {
    if (!this.queue) {
      return [];
    }
    const schedulers = await this.queue.getJobSchedulers(0, -1, true);
    return schedulers.map((scheduler) => scheduler.key);
  }
}
