import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { desc, eq, and } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import type { NotificationFailure } from '@statusbeam/contracts';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import {
  channels,
  incidentUpdates,
  incidents,
  monitors,
  notificationFailures,
  projects,
} from '../../db/schema';
import type { NotificationFailure as NotificationFailureRow } from '../../db/schema';
import { NOTIFICATIONS_QUEUE, NOTIFICATION_DLQ } from './notifications.tokens';

export const MAX_DELIVERY_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 30_000;

function toFailureResponse(row: NotificationFailureRow): NotificationFailure {
  return {
    id: row.id,
    jobId: row.jobId,
    channelId: row.channelId,
    incidentUpdateId: row.incidentUpdateId,
    errorClass: row.errorClass,
    message: row.message,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NOTIFICATIONS_QUEUE) private readonly queue: Queue | null,
    @Inject(NOTIFICATION_DLQ) private readonly dlq: Queue | null,
  ) {}

  public async enqueueForUpdate(update: typeof incidentUpdates.$inferSelect): Promise<string[]> {
    if (!this.queue) {
      return [];
    }

    const incidentRows = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, update.incidentId))
      .limit(1);
    const incident = incidentRows[0];
    if (!incident) {
      return [];
    }

    const monitorRows = await this.db
      .select()
      .from(monitors)
      .where(eq(monitors.id, incident.monitorId))
      .limit(1);
    const monitor = monitorRows[0];
    if (!monitor) {
      return [];
    }

    const targets = await this.db
      .select()
      .from(channels)
      .where(and(eq(channels.projectId, monitor.projectId), eq(channels.active, true)));

    const jobIds: string[] = [];
    for (const channel of targets) {
      const jobId = `notif:${update.id}:${channel.id}`;
      await this.queue.add(
        'deliver',
        { updateId: update.id, channelId: channel.id },
        {
          jobId,
          attempts: MAX_DELIVERY_ATTEMPTS,
          backoff: { type: 'exponential', delay: BACKOFF_BASE_MS },
          removeOnComplete: { age: 86_400 },
          removeOnFail: false,
        },
      );
      jobIds.push(jobId);
    }

    return jobIds;
  }

  public async recordFailure(input: {
    jobId: string;
    channelId: string;
    incidentUpdateId: string;
    errorClass: string;
    message: string;
    attempts: number;
  }): Promise<NotificationFailure> {
    const rows = await this.db
      .insert(notificationFailures)
      .values({
        jobId: input.jobId,
        channelId: input.channelId,
        incidentUpdateId: input.incidentUpdateId,
        errorClass: input.errorClass,
        message: input.message.slice(0, 1000),
        attempts: input.attempts,
      })
      .returning();
    const failure = rows[0];
    if (!failure) {
      throw new Error('notification failure insert returned no row');
    }

    if (this.dlq) {
      await this.dlq.add(
        'failed-delivery',
        {
          failureId: failure.id,
          updateId: input.incidentUpdateId,
          channelId: input.channelId,
        },
        { jobId: `dlq:${failure.id}`, removeOnComplete: false, removeOnFail: false },
      );
    }

    return toFailureResponse(failure);
  }

  public async listFailures(userId: string): Promise<NotificationFailure[]> {
    const rows = await this.db
      .select({ failure: notificationFailures })
      .from(notificationFailures)
      .innerJoin(channels, eq(notificationFailures.channelId, channels.id))
      .innerJoin(projects, eq(channels.projectId, projects.id))
      .where(eq(projects.userId, userId))
      .orderBy(desc(notificationFailures.createdAt))
      .limit(100);

    return rows.map((row) => toFailureResponse(row.failure));
  }

  public async replay(userId: string, failureId: string): Promise<{ jobId: string }> {
    if (!this.queue) {
      throw new ServiceUnavailableException('notification queue is disabled');
    }

    const rows = await this.db
      .select({ failure: notificationFailures, project: projects })
      .from(notificationFailures)
      .innerJoin(channels, eq(notificationFailures.channelId, channels.id))
      .innerJoin(projects, eq(channels.projectId, projects.id))
      .where(eq(notificationFailures.id, failureId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException('notification failure not found');
    }
    if (row.project.userId !== userId) {
      throw new ForbiddenException('notification failure belongs to another user');
    }
    if (!row.failure.incidentUpdateId || !row.failure.channelId) {
      throw new NotFoundException('notification failure has no replay target');
    }

    // The original job may still exist in the failed set; remove it so the deterministic
    // jobId can be re-added, otherwise BullMQ would silently dedupe the replay.
    const existing = await this.queue.getJob(row.failure.jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed') {
        await existing.remove();
      }
    }

    await this.queue.add(
      'deliver',
      { updateId: row.failure.incidentUpdateId, channelId: row.failure.channelId },
      {
        jobId: row.failure.jobId,
        attempts: MAX_DELIVERY_ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_BASE_MS },
        removeOnComplete: { age: 86_400 },
        removeOnFail: false,
      },
    );

    return { jobId: row.failure.jobId };
  }
}
