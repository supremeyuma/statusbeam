import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte } from 'drizzle-orm';

import type { PublicStatusResponse } from '@statusbeam/contracts';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { incidents, monitors, projects, rollups } from '../../db/schema';
import { REDIS } from '../../redis/redis.module';
import type Redis from 'ioredis';

const DAYS = 90;
const CACHE_TTL_SECONDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CachedStatus {
  body: string;
  etag: string;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class StatusService {
  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  public async getPublicStatus(slug: string): Promise<CachedStatus | null> {
    const cacheKey = `status:cache:${slug}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as CachedStatus;
      } catch {
        // fall through to rebuild
      }
    }

    const snapshot = await this.buildSnapshot(slug);
    if (!snapshot) {
      return null;
    }

    const body = JSON.stringify(snapshot);
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
    const value: CachedStatus = { body, etag };

    await this.redis
      .set(cacheKey, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS)
      .catch(() => null);
    return value;
  }

  public async buildSnapshot(slug: string): Promise<PublicStatusResponse | null> {
    const projectRows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.public, true)))
      .limit(1);
    const project = projectRows[0];
    if (!project) {
      return null;
    }

    const monitorRows = await this.db
      .select()
      .from(monitors)
      .where(and(eq(monitors.projectId, project.id), eq(monitors.active, true)))
      .orderBy(monitors.name);

    const since = new Date(Date.now() - (DAYS - 1) * DAY_MS);
    since.setUTCHours(0, 0, 0, 0);

    const rollupRows = await this.db
      .select({
        monitorId: rollups.monitorId,
        bucketHour: rollups.bucketHour,
        upCount: rollups.upCount,
        downCount: rollups.downCount,
      })
      .from(rollups)
      .where(gte(rollups.bucketHour, since));

    const perMonitor = new Map<string, Map<string, { up: number; down: number }>>();
    for (const row of rollupRows) {
      const day = utcDateKey(row.bucketHour);
      let days = perMonitor.get(row.monitorId);
      if (!days) {
        days = new Map();
        perMonitor.set(row.monitorId, days);
      }
      const bucket = days.get(day) ?? { up: 0, down: 0 };
      bucket.up += row.upCount;
      bucket.down += row.downCount;
      days.set(day, bucket);
    }

    const dayKeys: string[] = [];
    for (let index = DAYS - 1; index >= 0; index -= 1) {
      dayKeys.push(utcDateKey(new Date(Date.now() - index * DAY_MS)));
    }

    const publicMonitors = monitorRows.map((monitor) => {
      const byDay = perMonitor.get(monitor.id);
      let totalUp = 0;
      let totalDown = 0;

      const days = dayKeys.map((date) => {
        const bucket = byDay?.get(date);
        if (!bucket || bucket.up + bucket.down === 0) {
          return { date, uptimePct: null };
        }
        totalUp += bucket.up;
        totalDown += bucket.down;
        return {
          date,
          uptimePct: Math.round((bucket.up / (bucket.up + bucket.down)) * 10_000) / 100,
        };
      });

      const overall = totalUp + totalDown;
      return {
        id: monitor.id,
        name: monitor.name,
        type: monitor.type,
        status: monitor.lastStatus ?? ('unknown' as const),
        lastCheckedAt: monitor.lastCheckedAt ? monitor.lastCheckedAt.toISOString() : null,
        uptime90d: overall > 0 ? Math.round((totalUp / overall) * 10_000) / 100 : null,
        days,
      };
    });

    const incidentRows = await this.db
      .select({ incident: incidents, monitorName: monitors.name })
      .from(incidents)
      .innerJoin(monitors, eq(incidents.monitorId, monitors.id))
      .where(eq(monitors.projectId, project.id))
      .orderBy(desc(incidents.startedAt))
      .limit(20);

    const publicIncidents = incidentRows.map((row) => ({
      id: row.incident.id,
      monitorId: row.incident.monitorId,
      monitorName: row.monitorName,
      status: row.incident.status,
      startedAt: row.incident.startedAt.toISOString(),
      resolvedAt: row.incident.resolvedAt ? row.incident.resolvedAt.toISOString() : null,
      cause: row.incident.cause,
    }));

    const activeIncidents = publicIncidents.filter((incident) => incident.resolvedAt === null);
    const anyMonitorDown = publicMonitors.some((monitor) => monitor.status === 'down');
    const overallStatus = activeIncidents.length > 0 || anyMonitorDown ? 'down' : 'up';

    return {
      project: { name: project.name, slug: project.slug },
      overallStatus,
      updatedAt: new Date().toISOString(),
      monitors: publicMonitors,
      incidents: publicIncidents,
    };
  }

  /** Public SSE snapshot: same allowlisted data as the cached status endpoint. */
  public async snapshotForSlug(slug: string): Promise<PublicStatusResponse | null> {
    return this.buildSnapshot(slug);
  }

  public async findPublicProjectBySlug(slug: string): Promise<{ id: string } | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.slug, slug), eq(projects.public, true)))
      .limit(1);
    return rows[0] ?? null;
  }
}
