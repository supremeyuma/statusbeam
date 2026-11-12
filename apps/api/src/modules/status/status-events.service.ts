import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';

import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { projects } from '../../db/schema';
import { REDIS } from '../../redis/redis.module';

export type StatusEventType = 'incident' | 'check';

export interface StatusEvent {
  id: string;
  type: StatusEventType;
  payload: Record<string, unknown>;
}

const STREAM_MAX_LENGTH = 1000;
const MAX_SEQ_LENGTH = 20;

function normalizeLastEventId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d{1,20}(-\d+)?$/.test(trimmed)) {
    return undefined;
  }
  const [seq] = trimmed.split('-');
  if (!seq || seq.length > MAX_SEQ_LENGTH) {
    return undefined;
  }
  return seq;
}

@Injectable()
export class StatusEventsService {
  private readonly logger = new Logger(StatusEventsService.name);

  public constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  public channelFor(projectId: string): string {
    return `status:${projectId}`;
  }

  public streamKeyFor(projectId: string): string {
    return `status:stream:${projectId}`;
  }

  /**
   * Publishes a monotonic event to pub/sub and a capped stream. The stream id is the SSE
   * event id, so a reconnect with Last-Event-ID can replay exactly what it missed.
   */
  public async publish(
    projectId: string,
    type: StatusEventType,
    payload: Record<string, unknown>,
  ): Promise<StatusEvent> {
    const seq = await this.redis.incr(`status:seq:${projectId}`);
    const streamId = `${seq}-0`;
    const event: StatusEvent = { id: streamId, type, payload };
    const message = JSON.stringify(event);

    try {
      await this.redis.xadd(
        this.streamKeyFor(projectId),
        'MAXLEN',
        '~',
        STREAM_MAX_LENGTH,
        streamId,
        'event',
        message,
      );
      await this.redis.publish(this.channelFor(projectId), message);
    } catch (error) {
      // Realtime is best-effort: an incident must still open if Redis pub/sub is unavailable.
      this.logger.warn(
        `failed to publish ${type} event for project ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (type === 'incident') {
      try {
        const rows = await this.db
          .select({ slug: projects.slug })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        const slug = rows[0]?.slug;
        if (slug) {
          await this.redis.del(`status:cache:${slug}`);
        }
      } catch {
        // Cache invalidation is best-effort; the 10s TTL still bounds staleness.
      }
    }

    return event;
  }

  public async history(projectId: string, lastEventId: string | undefined): Promise<StatusEvent[]> {
    const normalized = normalizeLastEventId(lastEventId);
    if (!normalized) {
      return [];
    }

    const entries = await this.redis.xrange(this.streamKeyFor(projectId), `(${normalized}-0`, '+');

    const events: StatusEvent[] = [];
    for (const [, fields] of entries) {
      const raw = fields[1];
      if (!raw) {
        continue;
      }
      try {
        events.push(JSON.parse(raw) as StatusEvent);
      } catch {
        // Ignore an unparseable entry rather than breaking the stream.
      }
    }
    return events;
  }

  public async subscribe(projectId: string, handler: (event: StatusEvent) => void): Promise<Redis> {
    const subscriber = this.redis.duplicate();
    await subscriber.subscribe(this.channelFor(projectId));
    subscriber.on('message', (_channel, message) => {
      try {
        handler(JSON.parse(message) as StatusEvent);
      } catch {
        // Ignore malformed pub/sub payloads.
      }
    });
    return subscriber;
  }
}
