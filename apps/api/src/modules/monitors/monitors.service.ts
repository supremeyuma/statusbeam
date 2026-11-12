import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, or, lt } from 'drizzle-orm';

import type {
  CheckListResponse,
  HttpMonitorConfig,
  MonitorInput,
  MonitorResponse,
  MonitorUpdateInput,
  TcpMonitorConfig,
} from '@statusbeam/contracts';
import type { AuthPrincipal } from '../../common/auth-principal';
import { APP_CONFIG } from '../../common/config.module';
import type { AppConfig } from '../../common/config';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { monitors, checks } from '../../db/schema';
import type { Monitor } from '../../db/schema';
import { ProjectsService } from '../projects/projects.service';
import { SchedulerService } from '../../jobs/scheduler.service';
import { assertHttpTargetAllowed, assertTcpTargetAllowed } from './ssrf';

function encodeCursor(checkedAt: Date, id: number): string {
  return Buffer.from(`${checkedAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { checkedAt: Date; id: number } {
  try {
    const [rawDate, rawId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const checkedAt = new Date(rawDate ?? '');
    const id = Number(rawId);
    if (Number.isNaN(checkedAt.getTime()) || !Number.isInteger(id)) {
      throw new Error('invalid cursor payload');
    }
    return { checkedAt, id };
  } catch {
    throw new BadRequestException('invalid pagination cursor');
  }
}

export function toMonitorResponse(monitor: Monitor): MonitorResponse {
  return {
    id: monitor.id,
    projectId: monitor.projectId,
    name: monitor.name,
    type: monitor.type,
    config: monitor.config,
    intervalS: monitor.intervalS,
    timeoutMs: monitor.timeoutMs,
    retries: monitor.retries,
    active: monitor.active,
    nextRunAt: monitor.nextRunAt ? monitor.nextRunAt.toISOString() : null,
    lastStatus: monitor.lastStatus,
    lastCheckedAt: monitor.lastCheckedAt ? monitor.lastCheckedAt.toISOString() : null,
    createdAt: monitor.createdAt.toISOString(),
    updatedAt: monitor.updatedAt.toISOString(),
  };
}

@Injectable()
export class MonitorsService {
  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly projects: ProjectsService,
    private readonly scheduler: SchedulerService,
  ) {}

  public async create(auth: AuthPrincipal, input: MonitorInput): Promise<MonitorResponse> {
    await this.projects.assertAccess(auth, input.projectId);
    await this.validateTarget(input.type, input.config);

    const rows = await this.db
      .insert(monitors)
      .values({
        projectId: input.projectId,
        name: input.name,
        type: input.type,
        config: input.config,
        intervalS: input.intervalS,
        timeoutMs: input.timeoutMs,
        retries: input.retries,
        active: input.active,
        nextRunAt: new Date(Date.now() + input.intervalS * 1000),
      })
      .returning();

    const monitor = rows[0];
    if (!monitor) {
      throw new Error('monitor insert returned no row');
    }
    await this.scheduler.sync(monitor);
    return toMonitorResponse(monitor);
  }

  public async list(auth: AuthPrincipal, projectId: string): Promise<MonitorResponse[]> {
    await this.projects.assertAccess(auth, projectId);
    const rows = await this.db
      .select()
      .from(monitors)
      .where(eq(monitors.projectId, projectId))
      .orderBy(monitors.createdAt);
    return rows.map(toMonitorResponse);
  }

  public async get(auth: AuthPrincipal, id: string): Promise<MonitorResponse> {
    const monitor = await this.findAccessible(auth, id);
    return toMonitorResponse(monitor);
  }

  public async update(
    auth: AuthPrincipal,
    id: string,
    input: MonitorUpdateInput,
  ): Promise<MonitorResponse> {
    const monitor = await this.findAccessible(auth, id);

    if (input.config) {
      if (input.config.type !== monitor.type) {
        throw new BadRequestException('monitor type cannot change; create a new monitor instead');
      }
      await this.validateTarget(input.config.type, input.config.config);
    }

    const intervalS = input.intervalS ?? monitor.intervalS;
    const active = input.active ?? monitor.active;
    const rows = await this.db
      .update(monitors)
      .set({
        name: input.name ?? monitor.name,
        intervalS,
        timeoutMs: input.timeoutMs ?? monitor.timeoutMs,
        retries: input.retries ?? monitor.retries,
        active,
        ...(input.config ? { config: input.config.config } : {}),
        nextRunAt: active ? new Date(Date.now() + intervalS * 1000) : null,
        updatedAt: new Date(),
      })
      .where(eq(monitors.id, monitor.id))
      .returning();

    const updated = rows[0];
    if (!updated) {
      throw new NotFoundException('monitor not found');
    }
    await this.scheduler.sync(updated);
    return toMonitorResponse(updated);
  }

  public async remove(auth: AuthPrincipal, id: string): Promise<void> {
    const monitor = await this.findAccessible(auth, id);
    await this.scheduler.remove(monitor.id);
    await this.db.delete(monitors).where(eq(monitors.id, monitor.id));
  }

  public async listChecks(
    auth: AuthPrincipal,
    id: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<CheckListResponse> {
    await this.findAccessible(auth, id);

    const filters = [eq(checks.monitorId, id)];
    if (cursor) {
      const decoded = decodeCursor(cursor);
      filters.push(
        or(
          lt(checks.checkedAt, decoded.checkedAt),
          and(eq(checks.checkedAt, decoded.checkedAt), lt(checks.id, decoded.id)),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(checks)
      .where(and(...filters))
      .orderBy(checks.checkedAt, checks.id)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        id: row.id,
        monitorId: row.monitorId,
        region: row.region,
        status: row.status,
        latencyMs: row.latencyMs,
        statusCode: row.statusCode,
        error: row.error,
        checkedAt: row.checkedAt.toISOString(),
      })),
      nextCursor: hasMore && last ? encodeCursor(last.checkedAt, last.id) : null,
    };
  }

  private async findAccessible(auth: AuthPrincipal, id: string): Promise<Monitor> {
    const rows = await this.db.select().from(monitors).where(eq(monitors.id, id)).limit(1);
    const monitor = rows[0];
    if (!monitor) {
      throw new NotFoundException('monitor not found');
    }
    await this.projects.assertAccess(auth, monitor.projectId);
    return monitor;
  }

  private async validateTarget(
    type: MonitorInput['type'],
    config: HttpMonitorConfig | TcpMonitorConfig,
  ): Promise<void> {
    if (type === 'http') {
      const httpConfig = config as HttpMonitorConfig;
      if (httpConfig.bodyRegex !== undefined) {
        try {
          new RegExp(httpConfig.bodyRegex);
        } catch {
          throw new BadRequestException('bodyRegex is not a valid regular expression');
        }
      }
      await assertHttpTargetAllowed(httpConfig.url, this.config.allowPrivateTargets);
      return;
    }

    const tcpConfig = config as TcpMonitorConfig;
    await assertTcpTargetAllowed(tcpConfig.host, this.config.allowPrivateTargets);
  }
}
