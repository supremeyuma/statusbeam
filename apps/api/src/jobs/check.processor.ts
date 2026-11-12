import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE } from '../db/database.module';
import type { Database } from '../db/client';
import { MetricsService } from '../common/metrics.service';
import { checks, monitors } from '../db/schema';
import { CheckerService } from '../modules/checks/checker.service';
import { LockService } from '../modules/checks/lock.service';
import { IncidentEvaluator } from '../modules/incidents/evaluator.service';

export type CheckOutcome = 'checked' | 'skipped' | 'missing' | 'inactive';

@Injectable()
export class CheckProcessor {
  private readonly logger = new Logger(CheckProcessor.name);

  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly checker: CheckerService,
    private readonly lock: LockService,
    private readonly metrics: MetricsService,
    private readonly evaluator: IncidentEvaluator,
  ) {}

  public async process(
    monitorId: string,
    jobTimestamp: number = Date.now(),
  ): Promise<CheckOutcome> {
    const rows = await this.db.select().from(monitors).where(eq(monitors.id, monitorId)).limit(1);
    const monitor = rows[0];

    if (!monitor) {
      return 'missing';
    }
    if (!monitor.active) {
      return 'inactive';
    }

    const lockKey = `lock:check:${monitor.id}`;
    const token = await this.lock.acquire(lockKey, monitor.timeoutMs + 2000);
    if (!token) {
      this.metrics.checkSkipped.inc();
      return 'skipped';
    }

    const started = performance.now();
    try {
      const result = await this.checker.check(monitor);
      const now = new Date();
      const error = result.ok ? null : `${result.errorClass}: ${result.message}`.slice(0, 500);

      await this.db.insert(checks).values({
        monitorId: monitor.id,
        status: result.ok ? 'up' : 'down',
        latencyMs: result.latencyMs,
        ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
        error,
        checkedAt: now,
      });

      await this.db
        .update(monitors)
        .set({
          lastStatus: result.ok ? 'up' : 'down',
          lastCheckedAt: now,
          nextRunAt: new Date(now.getTime() + monitor.intervalS * 1000),
          updatedAt: now,
        })
        .where(eq(monitors.id, monitor.id));

      this.metrics.checkDuration.observe(
        { type: monitor.type, status: result.ok ? 'up' : 'down' },
        (performance.now() - started) / 1000,
      );
      this.metrics.schedulerLag.observe(Math.max(0, (Date.now() - jobTimestamp) / 1000));

      try {
        await this.evaluator.evaluate(monitor.id);
      } catch (error) {
        this.logger.error(
          `incident evaluation failed for monitor ${monitor.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      return 'checked';
    } catch (error) {
      this.logger.error(
        `check failed for monitor ${monitor.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      await this.lock.release(lockKey, token);
    }
  }
}
